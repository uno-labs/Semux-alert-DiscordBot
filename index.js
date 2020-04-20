'use strict'

const Discord = require('discord.js')
const rp = require('request-promise')
const botSettings = require('./config/config-bot.json') // Настройки конфигурации бота
const bot = new Discord.Client({ disableEveryone: true })
const EXCHANGES = require('./config/exchanges.json') //Список биржевых аккаунтов 
const WHALE_THRESHOLD_VALUE = 2500 // SEM  
const FUNDS = require('./config/funds.json') //Список аккаунтов, для слежения за донатами
const PUBLIC_POOLS = require('./config/public-pools.json') //Список аккаунтов публичных пулов
const API = 'https://api.semux.online/v2.3.0/' // API ноды

const IGNORE_LIST = new Map()
let BEST_HEIGHT = 0

bot.on('ready', () => {
  console.log('Bot is online')
})


// Сканируем новый блок каждые 10 сек, отслеживаем транзакции в блоке
/*
Алерты:
- Крупный биржевой ввод и вывод
- Регистрация нового делегата
- Донат на контролируемый адрес

*/
setInterval(async function () {
  var result = await scanNewBlock()
  if (result.error) {
    return
  }
  for (let tx of result.transfers) {
    switch (tx.type) {
      case 'deposited': bot.channels.find(c => c.name === 'uno-labs').send(`**[whale alert]** ${tx.value} SEM ${tx.type} to ${tx.account} :inbox_tray:`)
      break;
      case 'withdrawn': bot.channels.find(c => c.name === 'uno-labs').send(`**[whale alert]** ${tx.value} SEM ${tx.type} from ${tx.account} :outbox_tray:`)
      break;
      case 'donated': bot.channels.find(c => c.name === 'uno-labs').send(`Thank you very much for the donation! ${tx.value} SEM :thumbsup: https://semux.top/address/${tx.account}`)
      break;
      case 'delegate': bot.channels.find(c => c.name === 'bla-bla-bla').send(`:partying_face: New delegate! https://semux.top/delegate/${tx.value}`)
      break;
    }
  }
}, 10 * 1000)

async function scanNewBlock() {
  let lastHeight;
  try {
    lastHeight = JSON.parse(await rp(`${API}latest-block-number`))
  } catch (e) {
    console.error('Failed to get latest block number', e.message)
    return { error: true }
  }
  lastHeight = parseInt(lastHeight.result, 10)
  if (lastHeight === BEST_HEIGHT) {
    return { error: true }
  }
  BEST_HEIGHT = lastHeight
  let block;
  try {
    block = JSON.parse(await rp(`${API}block-by-number?number=${BEST_HEIGHT}`))
  } catch (e) {
    console.error('Failed to get block by number', e.message)
    return { error: true }
  }
  if (!block.result || !block.result.transactions) {
    return { error: true }
  }
  let transfers = [];
  for (let tx of block.result.transactions) {
    let value = parseInt(tx.value, 10) / 1e9
    switch (tx.type) {
      case 'TRANSFER': 
        if (value > WHALE_THRESHOLD_VALUE && EXCHANGES[tx.from]) {
          transfers.push({ account: EXCHANGES[tx.from], value: value.toFixed(2), type: 'withdrawn' })
        }
        if (value > WHALE_THRESHOLD_VALUE && EXCHANGES[tx.to]) {
          transfers.push({ account: EXCHANGES[tx.to], value: value.toFixed(2), type: 'deposited' })
        }  
        if (FUNDS[tx.to]) {
          transfers.push({ account: tx.to, value: value.toFixed(2), type: 'donated' })
        }  
      break;
      case 'DELEGATE': 
        transfers.push({ account: tx.from, value: hexToString(tx.data), type: 'delegate' })
      break;
    }

  }
  return { success: true, transfers: transfers }
}


//Следим за валидаторами публичных пулов

/*

Алерты:
- Валидатор выпал из Топ-100 (алерт не чаще раз в сутки)

*/

setInterval(async function () {
  var result = await scanDelegates()
  if (result.error) {
    return
  }
  for (let pool of result.pools) {
    bot.channels.find(c => c.name === 'uno-labs').send(`:scream:  Pool https://semux.top/address/${pool.validator} needs votes to get back in Top-100!`)
  }
}, 300 * 1000)


async function scanDelegates() {
  let delegates = [];
  try {
    delegates = JSON.parse(await rp(`${API}delegates`))
  } catch (e) {
    console.error('Failed to get list of delegates', e.message)
    return { error: true }
  }
  let pools = []; 
  let rank = 1
  if (!delegates.result) {
    return { error: true }
  }
  for (let delegate of delegates.result) {
    if (PUBLIC_POOLS[delegate.address]) {
      if (!IGNORE_LIST.get(delegate.address)) {
        if (rank > 100) {
          IGNORE_LIST.set(delegate.address, Date.now())
          pools.push({validator: PUBLIC_POOLS[delegate.address], rank: rank})
        }
      } else {
        let longTime = Date.now() - IGNORE_LIST.get(delegate.address)
        if (longTime > 60 * 60 * 24 * 1000 && rank < 101) {
          IGNORE_LIST.delete(delegate.address)
        }
      }
    }
    rank +=1
  }
  return { success: true, pools: pools }
}

function hexToString (hex) {
  var string = '';
  for (var i = 2; i < hex.length; i += 2) {
    string += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return string;
}

bot.login(botSettings.token)
