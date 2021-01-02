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

// Legacy support for `app` object within options (moved to root level in 1.6.0)
options = {
  ...options,
  ...options.app,
};
delete options.app;

// Utility functions
const utility = {
  // Add commas to number
  addCommas: string => string.toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1,'),

  // Return a rounded number of desired precision
  fixed: (number, precision) => Math.round(number * `1e${precision}`) / `1e${precision}`,
};

// Write display to STDOUT
let previousPriceData = {};
const priceDataHistory = {};
const exchangeLookup = {};
let previousPrimaryCurrency = null;
let previousSecondaryCurrency = null;
let statusOutput = '';
let lastUpdate = +Date.now();
let retrievalError = false;
const writeToStdout = (limitReached, priceData, allowance) => {
  let outputData = priceData;

  // Clear screen
  process.stdout.write('\x1Bc');
  process.stdout.write('\n');

  // Set status message for connectivity or API limit issues
  if (!priceData) {
    const lastUpdateText = colors.grey(` / Last updated ${moment(lastUpdate).fromNow()}\n\n`);

    if (_.keys(previousPriceData).length) {
      outputData = previousPriceData;
    }

    if (limitReached) {
      statusOutput = colors.red(' ⚠ API limit has been reached') + lastUpdateText;
    } else {
      statusOutput = colors.red(' ⚠ Data retrieval error') + lastUpdateText;
    }

    retrievalError = true;
  } else if (allowance && allowance.remaining < 1) {
    statusOutput = colors.yellow(' ⚠ API limit is close to being reached\n\n');
    retrievalError = false;
  } else {
    lastUpdate = +Date.now();
    statusOutput = '';
    retrievalError = false;
  }

  const sortedPrimaryCurrencies = _.keys(outputData).sort();

  _.forEach(sortedPrimaryCurrencies, (primaryCurrency) => {
    const sortedSecondaryCurrencies = _.keys(outputData[primaryCurrency]).sort();

    _.forEach(sortedSecondaryCurrencies, (secondaryCurrency) => {
      const sortedExchanges = _.keys(outputData[primaryCurrency][secondaryCurrency]).sort();

      _.forEach(sortedExchanges, (exchange) => {
        let changePercentageFixed;
        const exchangePriceData = outputData[primaryCurrency][secondaryCurrency][exchange];
        const changePercentage = Math.abs(exchangePriceData.price.change.percentage) * 100;
        let lastPriceValue = outputData[primaryCurrency][secondaryCurrency][exchange].price.last;
        let primaryCurrencyOutput = '';
        let secondaryCurrencyOutput = '';
        let exchangeOutput = '';
        let changeOutput = '';
        let historyChangeOutput = '';

        // Set precision based on amount
        if (changePercentage >= 100) {
          changePercentageFixed = changePercentage.toFixed(0);
        } else if (changePercentage >= 10) {
          changePercentageFixed = changePercentage.toFixed(1);
        } else {
          changePercentageFixed = changePercentage.toFixed(2);
        }

        // Show primary currency name
        if (previousPrimaryCurrency !== primaryCurrency) {
          primaryCurrencyOutput = colors.bold.white(` › ${primaryCurrency}`)
            + pad(outputData.longestPrimaryCurrencyLength - primaryCurrency.length, '')
            + pad(options.padding, '');
          previousPrimaryCurrency = primaryCurrency;
        } else {
          primaryCurrencyOutput = colors.bold(pad(outputData.longestPrimaryCurrencyLength + 3, ''))
            + pad(options.padding, '');
        }

        // Show secondary currency name
        if (previousSecondaryCurrency !== secondaryCurrency) {
          secondaryCurrencyOutput = secondaryCurrency
            + pad(outputData.longestSecondaryCurrencyLength - secondaryCurrency.length, '')
            + pad(options.padding, '');
          previousSecondaryCurrency = secondaryCurrency;
        } else {
          secondaryCurrencyOutput = pad(outputData.longestSecondaryCurrencyLength, '')
            + pad(options.padding, '');
        }

        // Show exchange name
        exchangeOutput = pad(exchange, outputData.longestExchangeLength) + pad(options.padding, '');

        // Show percent change in last 24 hours
        if (utility.fixed(exchangePriceData.price.change.percentage * 100, 2) > 0) {
          changeOutput = pad(colors.green(`▲ ${changePercentageFixed.toString()}%`), 15);
        } else if (utility.fixed(exchangePriceData.price.change.percentage * 100, 2) < 0) {
          changeOutput = pad(colors.red(`▼ ${changePercentageFixed.toString()}%`), 15);
        } else {
          changeOutput = pad('', 7);
        }

        // Show history of price updates
        if (
          options.history.enabled
          && previousPriceData
          && previousPriceData[primaryCurrency]
          && previousPriceData[primaryCurrency][secondaryCurrency]
          && previousPriceData[primaryCurrency][secondaryCurrency][exchange]
          && +(previousPriceData[primaryCurrency][secondaryCurrency][exchange].price.last)
        ) {
          const currentLastPrice = utility.fixed(exchangePriceData.price.last, 6);
          const previousExchangeData = previousPriceData[primaryCurrency][secondaryCurrency][exchange];
          const previousLastPrice = utility.fixed(previousExchangeData.price.last, 6);
          const { majorThreshold } = options.history;
          const dataKey = primaryCurrency + secondaryCurrency + exchange;
          const percentageChange = utility.fixed((Math.abs(currentLastPrice - previousLastPrice) / previousLastPrice), 8) * 100;
          let symbol;

          // Determine history symbol
          if (percentageChange > majorThreshold) {
            symbol = currentLastPrice > previousLastPrice
              ? options.history.positiveMajorSymbol
              : options.history.negativeMajorSymbol;
          } else {
            symbol = currentLastPrice > previousLastPrice
              ? options.history.positiveMinorSymbol
              : options.history.negativeMinorSymbol;
          }

          priceDataHistory[dataKey] = priceDataHistory[dataKey] || new Array(options.history.length).fill(' ');

          if (
            currentLastPrice > previousLastPrice
            && utility.fixed(currentLastPrice - previousLastPrice, 6) > options.history.minorThreshold
          ) {
            // Price has increased since last update and was greater than threshold
            priceDataHistory[dataKey].push(colors.green.bold(symbol));
          } else if (
            currentLastPrice < previousLastPrice
            && utility.fixed(previousLastPrice - currentLastPrice, 6) > options.history.minorThreshold
          ) {
            // Price has decreased since last update and was greater than threshold
            priceDataHistory[dataKey].push(colors.red.bold(symbol));
          } else {
            priceDataHistory[dataKey].push(retrievalError ? ' ' : colors.grey(options.history.neutralSymbol));
          }

          historyChangeOutput = currentLastPrice - previousLastPrice;

          // Format history output, set precision based on amount
          if (historyChangeOutput === 0 || options.history.hideAmount) {
            historyChangeOutput = '';
          } else if (historyChangeOutput > 0) {
            if (historyChangeOutput >= 1) {
              historyChangeOutput = `+${utility.addCommas(historyChangeOutput.toFixed(2))}`;
            } else {
              historyChangeOutput = `+${utility.fixed(historyChangeOutput, 6)}`;
            }
          } else if (historyChangeOutput <= -1) {
            historyChangeOutput = `${utility.addCommas(historyChangeOutput.toFixed(2))}`;
          } else {
            historyChangeOutput = `${utility.fixed(historyChangeOutput, 6)}`;
          }
        }

        // Set precision based on amount
        if (lastPriceValue >= 1) {
          lastPriceValue = utility.addCommas(lastPriceValue.toFixed(2));
        } else {
          lastPriceValue = lastPriceValue.toFixed(6);
        }

        // eslint-disable-next-line prefer-template, no-useless-concat, max-len
        process.stdout.write(primaryCurrencyOutput + secondaryCurrencyOutput + exchangeOutput + pad(10, lastPriceValue) + ' ' + changeOutput + ` ${(priceDataHistory[primaryCurrency + secondaryCurrency + exchange] || '') && priceDataHistory[primaryCurrency + secondaryCurrency + exchange].slice(-1 * options.history.length).join('')}` + ` ${colors.grey(historyChangeOutput)}` + '\n');
      });

      process.stdout.write('\n');
    });

    previousSecondaryCurrency = null;
  });

  process.stdout.write(`${statusOutput}`);

  previousPrimaryCurrency = null;
  previousPriceData = outputData;

  return true;
};

