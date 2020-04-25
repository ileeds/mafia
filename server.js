const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const {
  start,
  messageAll,
  nominate,
  vote,
  night
} = require('./index');

const app = express();
app.use(bodyParser.urlencoded({
  extended: false
}));

let gameState = 'Day';

app.post('/sms', (req, res) => {
  const number = req.body.From;
  const text = req.body.Body;
  if (text) {
    let result = {};
    if (gameState === 'Day') {
      result = nominate(number, text);
    } else if (gameState === 'Vote') {
      result = vote(number, text);
    } else if (gameState === 'Night') {
      result = night(number, text);
    }

    if (result.newState) {
      gameState = result.newState;
    }
    if (result.response) {
      const twiml = new MessagingResponse();
      twiml.message(result.response);
      res.writeHead(200, {
        'Content-Type': 'text/xml'
      });
      res.end(twiml.toString());
    }
    if (result.all) {
      messageAll(result.all);
    }
  }
});

http.createServer(app).listen(1337, () => {
  console.log('Express server listening on port 1337');
  start();
});