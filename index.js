const _ = require('lodash');

const players = require('./players');
const client = require('./client');

let positions = ['good', 'mafia', 'medic'];
const positionCount = _.countBy(positions);

const positionIsGood = (position) => 
  position === 'good' || position === 'medic';
;

let toBeVoted = {};
let todaysVoted = [];

let selectedVictim = {};
let medicCurrentSaved = {};
let medicPreviousSaved = {};

const medicActive = positions.includes('medic');

const getInitMessage = (player, position) => {
  let message;
  if (position === 'good') {
    message = 'You are neutral good. ';
  } else if (position === 'mafia') {
    if (positionCount.mafia === 1) {
      message = 'You are the only Mafia. At night, the name you text will be slayed. ';
    } else {
      const otherMafia = _.filter(players, function(p) {
        return p.position === 'mafia' && p !== player;
      });
      const otherMafiaNames = _.map(otherMafia, o => o.name);
      message = 'You are mafia. ';
      message += positionCount.mafia > 2 ? `There other Mafiosi are ${otherMafiaNames.join(", ")}. ` : `There other Mafia is ${otherMafiaNames}. `;
      message += 'At night, the first of you to text a name will slay that person - deliberate amongst yourselves wisely. ';
    }
  } else if (position === 'medic') {
    message = 'You are the medic. Each night you can select one person to save from mafia execution, but not the same person 2 nights in a row. ';
  }

  if (positionIsGood(position)) {
    message += positionCount.mafia > 1 ? `There are ${positionCount.mafia} Mafiosi. ` : 'There is 1 Mafia. ';
  }

  const otherPlayers = _.filter(players, function(p) {
    return p !== player;
  });
  const otherPlayerNames = _.map(otherPlayers, o => o.name);
  return `${message}You may nominate ${otherPlayerNames.join(", ")} by texting their name now, or the majority may text Skip to enter the night. The game is afoot!`;
};


const start = () => {
  if (positions.length !== players.length) {
    console.log('Check setup');
    return;
  }

  positions = _.shuffle(positions);
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    players[i].position = position;
    players[i].alive = true;
    players[i].nominated = false;
    players[i].skip = false;
    players[i].vote = false;
  }
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    players[i].message = getInitMessage(players[i], position);
  }

  for (let i = 0; i < positions.length; i++) {
    const text = {
      to: players[i].number,
      from: '18135678524',
      body: players[i].message
    };
    client.messages.create(text);
  }
};

const messageAll = (message) => {
  for (let i = 0; i < positions.length; i++) {
    const text = {
      to: players[i].number,
      from: '18135678524',
      body: message
    };
    client.messages.create(text);
  }
};

const nominate = (number, text) => {
  const self = findByNumber(number);
  if (!self) {
    console.log(`Self not found for number ${number}`);
    return {
      response: `Sorry, something went wrong.`
    };
  }
  if (!self.alive) {
    return {};
  }
  if ('skip' === _.lowerCase(text)) {
    if (!self.skip) {
      self.skip = true;
    }
    if (skipVote()) {
      return {
        newState: 'Night',
        all: 'The majority has voted to abstain from a vote. We now enter the night.'
      };
    }
    return {
      response: `Your skip vote has been registered.`
    };
  }
  const nominee = findByName(text);
  if (!nominee) {
    return {
      response: `${text} is not a valid nomination.`
    };
  }
  if (nominee.name === self.name) {
    return {
      response: `You may not nominate yourself.`
    };
  }
  if (!nominee.alive) {
    return {
      response: `${text} has already perished.`
    };
  }
  if (todaysVoted.includes(nominee)) {
    return {
      response: `${text} has already survived an inquisition today.`
    };
  }
  if (!nominee.nominated) {
    self.skip = false;
    nominee.nominated = self;
    return {
      all: `${text} has been nominated by ${self.name}. Will anyone second?`
    };
  }
  if (nominee.nominated) {
    if (nominee.nominated === self) {
      return {
        response: `You have already nominated ${text}`
      };
    }
    _.forEach(players, p => {
      p.nominated = false;
      p.skip = false;
    });
    toBeVoted = nominee;
    return {
      newState: 'Vote',
      all: `The nomination of ${text} has been seconded. We are entering a vote.
            ${text} is permitted to defend themselves until all votes have been cast.
            Text 0 to show mercy, or text 1 to bring ${text} to swift justice.`
    };
  }

  console.log(`Unexpected result for ${number} and ${text}`);
  return {
    response: `Sorry, something went wrong.`
  };
};

const vote = (number, text) => {
  const self = findByNumber(number);
  if (!self) {
    console.log(`Self not found for number ${number}`);
    return {
      response: `Sorry, something went wrong.`
    };
  }
  if (!self.alive) {
    return {};
  }
  if (toBeVoted === self || self.vote) {
    return {
      response: `You may not vote at this time.`
    };
  }
  if (text === '0') {
    self.vote = 'spare';
  } else if (text === '1') {
    self.vote = 'kill';
  } else {
    return {
      response: `You may only text 0 or 1.`
    };
  }

  const allVotesIn = _.every(players, p => p.vote || !p.alive || p === toBeVoted);
  if (!allVotesIn) {
    return {
      response: `Your vote has been registered.`
    };
  }
  return evalVotes();
};

const night = (number, text) => {
  const self = findByNumber(number);
  if (!self) {
    console.log(`Self not found for number ${number}`);
    return {
      response: `Sorry, something went wrong.`
    };
  }
  if (!self.alive) {
    return {};
  }
  if (self.position === 'mafia') {
    if (!_.isEmpty(selectedVictim)) {
      return {
        response: `A victim has already been selected.`
      };
    }
    const victim = findByName(text);
    if (!victim) {
      return {
        response: `${text} is not a valid name.`
      };
    }
    if (victim.name === self.name) {
      return {
        response: `You may not eliminate yourself.`
      };
    }
    if (!victim.alive) {
      return {
        response: `${text} has already perished.`
      };
    }

    selectedVictim = victim;
    return resolveNight();
  } else if (self.position === 'medic') {
    const saved = findByName(text);
    if (!saved) {
      return {
        response: `${text} is not a valid name.`
      };
    }
    if (!saved.alive) {
      return {
        response: `${text} has already perished.`
      };
    }
    if (saved === medicPreviousSaved) {
      return {
        response: `You may not save the same person twice in a row.`
      };
    }

    medicCurrentSaved = saved;
    return resolveNight();
  }

  return {};
};

const resolveNight = () => {
  if (medicActive && (_.isEmpty(selectedVictim) || _.isEmpty(medicCurrentSaved))) {
    return {
      response: 'Your request has been confirmed.'
    };
  }

  const killConfirmed = selectedVictim !== medicCurrentSaved;
  if (killConfirmed) {
    selectedVictim.alive = false;
  }
  selectedVictim = {};
  medicPreviousSaved = medicCurrentSaved;
  medicCurrentSaved = {};
  let message = killConfirmed ?
    `There has been a lot of murder and a lot of intrigue. My little heart can barely take it no more. 
    ${text} has been vanquished in the night. ` :
    'An unexpected grace has befallen the townspeople this night. No one has perished. ';
  const mafiaRemaining = _.filter(players, function(p) {
    return !positionIsGood(p.position) && p.alive;
  });
  const goodRemaining = _.filter(players, function(p) {
    return positionIsGood(p.position) && p.alive;
  });
  if (_.size(mafiaRemaining) > _.size(goodRemaining)) {
    message += 'The mafia have overrun the town. Crime reigns supreme.';
  } else {
    message += 'We now enter the day.';
  }
  return {
    newState: 'Day',
    all: message
  };
};

const findByName = (name) => {
  return _.find(players, function(p) {
    return p.name === name;
  });
};

const findByNumber = (number) => {
  return _.find(players, function(p) {
    return p.number === number.slice(-p.number.length);
  });
};

const skipVote = () => {
  const remainingPlayers = _.filter(players, function(p) {
    return p.alive;
  });
  const skipCount = _.countBy(remainingPlayers, 'skip');
  return skipCount.true >= Math.ceil(_.size(remainingPlayers) / 2);
};

const evalVotes = () => {
  const result = {};
  todaysVoted.push(toBeVoted);
  const evaluated = toBeVoted;
  toBeVoted = {};

  const inFavor = _.filter(players, function(p) {
    return p.vote === 'kill';
  });
  const inFavorNames = _.map(inFavor, o => o.name);
  const opposed = _.filter(players, function(p) {
    return p.vote === 'spare';
  });
  const opposedNames = _.map(opposed, o => o.name);

  _.forEach(players, p => {
    p.vote = false;
  });

  const wasKilled = _.size(inFavor) > _.size(opposed);
  if (wasKilled) {
    evaluated.alive = false;
  }

  let message = 'The votes are in. ';
  if (_.size(inFavorNames) === 0) {
    message += 'No one voted to kill. ';
  } else if (_.size(opposedNames) === 0) {
    message += 'Everyone has voted to kill. ';
  } else {
    const killMessage = _.size(inFavorNames) === 1 ? `${inFavorNames} has voted to kill. ` : `${inFavorNames.join(", ")} have voted to kill. `;
    const spareMessage = _.size(opposedNames) === 1 ? `${opposedNames} has voted not to kill. ` : `${opposedNames.join(", ")} have voted not to kill. `;
    message += `${killMessage} ${spareMessage}`;
  }

  const mafiaRemaining = _.filter(players, function(p) {
    return !positionIsGood(p.position) && p.alive;
  });
  const goodRemaining = _.filter(players, function(p) {
    return positionIsGood(p.position) && p.alive;
  });
  if (_.size(mafiaRemaining) === 0) {
    message += 'The good townspeople have snuffed out the last remaining Mafiosi, and peace has been restored!';
  } else if (_.size(mafiaRemaining) > _.size(goodRemaining)) {
    message += 'The mafia have overrun the town. Crime reigns supreme.';
  } else {
    if (wasKilled) {
      message += `Thus, ${evaluated.name} has been sentenced to death. We now enter the night.`;
      result.newState = 'Night';
    } else {
      message += `Thus, ${evaluated.name} lives to fight another day.`;
      result.newState = 'Day';
      if (noNomineesRemaining()) {
        message += ' There are no nominees remaining, so we now enter the night.';
        result.newState = 'Night';
      }
    }
  }

  result.all = message;
  return result;
};

const noNomineesRemaining = () => {
  return _.every(players, p => !p.alive || todaysVoted.includes(p));
};

module.exports = {
  start,
  messageAll,
  nominate,
  vote,
  night
};
