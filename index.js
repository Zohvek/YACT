const colors = require('colors');
const pad = require('pad');
const needle = require('needle');
const yargs = require('yargs');
const pjson = require('./package.json');
let options = require('./options.json');
const moment = require('moment');
const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const args = yargs.argv;

// https://www.npmjs.com/package/needle
//lets try using needle..
needle.defaults({
  open_timeout: 3000,
  user_agent: `${pjson.name}/${pjson.version}`,
});

// check our config status
if (fs.existsSync(`${os.homedir()}/.${pjson.name}`)) {
  options = JSON.parse(fs.readFileSync(`${os.homedir()}/.${pjson.name}`, 'utf8'));
}

// Handle arguments
if (args) {
  const apiKey = args.apikey || args['api-key'] || args.apiKey;

  // Disable history
  if (args.nohistory || args['no-history']) {
    options.history.enabled = false;
  }

  // Set interval
  if (parseInt(args.interval, 10)) {
    options.pollInterval = parseInt(args.interval, 10);
  }

  // Set list of markets
  if (args.markets && args.markets.length) {
    options.markets = args.markets.replace(/\s/g, '').split(',');
  }

  // Set Cryptowat.ch API key
  if (apiKey) {
    options.apiKey = apiKey;
  }
}

