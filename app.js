'use strict';

const dialogflow = require('dialogflow');
require('./env');
const express = require('express');
const log = require('./services/log');
const bodyParser = require('body-parser');
const app = express();
const uuid = require('uuid');

let dialogflowService = require('./services/dialogflow-service');
const fbService = require('./services/fb-service');
const userService = require('./services/user-service');

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: fbService.verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());



app.set('view engine', 'ejs');


const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
    {
        projectId: process.env.GOOGLE_PROJECT_ID,
        credentials
    }
);


const sessionIds = new Map();
const usersMap = new Map();
const usersSentiment = new Map();
// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Secondary Receiver is in control - listen on standby channel
            if (pageEntry.standby) {
                // iterate webhook events from standby channel
                pageEntry.standby.forEach(event => {
                    const psid = event.sender.id;
                    const message = event.message;
                });
            }

            // Bot is in control - listen for messages
            if (pageEntry.messaging) {
                // Iterate over each messaging event
                pageEntry.messaging.forEach(function (messagingEvent) {
                    console.log(messagingEvent);
                    
                    if (messagingEvent.message) {
                        receivedMessage(messagingEvent);
                    }
                    else if (messagingEvent.postback) {
                        receivedPostback(messagingEvent);
                    }
                    else if (messagingEvent.pass_thread_control) {
                        // do something with the metadata: messagingEvent.pass_thread_control.metadata
                    } else {
                        console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                    }
                });
            }
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});


function setSessionAndUser(senderID) {
    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    if (!usersMap.has(senderID)) {
        userService.addUser(function (user) {
            usersMap.set(senderID, user);
        }, senderID);
    }
}


function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    setSessionAndUser(senderID);

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        fbService.handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }

    if (messageText) {
        //send message to DialogFlow
        dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, messageText);
    } else if (messageAttachments) {
        fbService.handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    switch (quickReplyPayload) {

        default:
            dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, quickReplyPayload);
            break;
    }
}


function handleDialogFlowAction(sender, action, messages, contexts, parameters) {
    switch (action) {

        default:
            //unhandled action, just send back the text
            fbService.handleMessages(messages, sender);
    }
}


function handleDialogFlowResponse(sender, response) {
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    fbService.sendTypingOff(sender);

    // here is where we check for sentiment results

    // In cases where the sentiment analysis score is 0, the returned sentimentAnalysisResult field will be empty!!!

    let sentimentResult = {
        score: 0,
        magnitude: 0,
        text: response.queryText
    };

    if (response.sentimentAnalysisResult) {
        sentimentResult.score = response.sentimentAnalysisResult.queryTextSentiment.score;
        sentimentResult.magnitude = response.sentimentAnalysisResult.queryTextSentiment.magnitude;
    }

    let snt = {};
    let beforeSentiment;

    if (usersSentiment.has(sender)) {
        snt = usersSentiment.get(sender);
    }

    snt[Math.floor(Date.now() / 1000)] = sentimentResult;


    usersSentiment.set(sender, snt);

    let differenceInScore = (beforeSentiment === undefined) ?
        0 : Math.abs(beforeSentiment.score - sentimentResult.score);

    if (response.sentimentAnalysisResult && differenceInScore > 0.5 &&
        sentimentResult.score < 0 && sentimentResult.score > -0.6) {

        fbService.sendTextMessage(sender, 'Did I say something wrong? ' +
            'Type help to find out how I can serve you better.');

    } else if (response.sentimentAnalysisResult && sentimentResult.score < -0.5) {
        fbService.sendTextMessage(sender, 'I sense you are not satisfied with my answers. ' +
            'Let me call Jana for you. She should be here ASAP.');

        fbService.sendPassThread(sender);

    } else if (fbService.isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (fbService.isDefined(messages)) {
        fbService.handleMessages(messages, sender);
    } else if (responseText == '' && !fbService.isDefined(action)) {
        //dialogflow could not evaluate input.
        fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (fbService.isDefined(responseText)) {
        fbService.sendTextMessage(sender, responseText);
    }
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID);

    // The 'payload' param is a developer-defined field which is set in a postback 
    // button for Structured Messages. 
    var payload = event.postback.payload;

    switch (payload) {

        default:
            //unindentified payload
            fbService.sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    log.magenta("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}

// Spin up the server
app.listen(app.get('port'), function () {
    log.green('running on port', app.get('port'))
})
