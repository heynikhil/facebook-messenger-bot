function prepare(color, ...logs) {
    let aLogs = []
    for (let iter = 0; iter < logs.length; iter++) {
        aLogs.push('\x1b' + color)
        aLogs.push(typeof logs[iter] === 'object' ? JSON.stringify(logs[iter], null,2): logs[iter])
    }
    aLogs.push('\x1b[0m')
    console.log(...aLogs)
}
const log = {}

log.black = (...logs) => prepare('[30m', ...logs)
log.red = (...logs) => prepare('[31m', ...logs)
log.green = (...logs) => prepare('[32m', ...logs)
log.yellow = (...logs) => prepare('[33m', ...logs)
log.blue = (...logs) => prepare('[34m', ...logs)
log.magenta = (...logs) => prepare('[35m', ...logs)
log.cyan = (...logs) => prepare('[36m', ...logs)
log.white = (...logs) => prepare('[37m', ...logs)

module.exports = log