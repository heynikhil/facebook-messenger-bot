'use strict';
const axios = require('axios');
const log = require("./log")

module.exports = {

    addUser: async function (callback, userId) {
        const url = `https://graph.facebook.com/v3.2/${userId}?access_token=${process.env.FB_PAGE_TOKEN}`;
        let response;
        try {
            response = await axios.get(url)
            
        } catch (error) {
            log.red(error.toString())
        }

    },



}
