'use strict'

var mutex = require('./index')

var delay = function(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms)
    })
}

var playerMutexes = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(function(playerName) {
    return mutex.create(playerName)
})

var gameBoardMutexes = ['gb1', 'gb2'].map(function(gameBoardName) {
    return mutex.create({
        play: function(playerA, playerB) {
            console.log(gameBoardName + ': ' + playerA + ' plays ' + playerB)

            return delay(30 + 70 * Math.random()).then(function() {
                console.log(
                    gameBoardName +
                    ': ' +
                    (Math.random() < 0.5 ? playerA : playerB) +
                    ' wins'
                )
            })
        }
    })
})

var getPairs = function(arr) {
  var results = []
 
  for (var i = 0; i !== arr.length; i++) {
    for (var j = i + 1; j !== arr.length; j++) {
      results.push([arr[i], arr[j]])
    }
  }
  
  return results
}
 
Promise.all(getPairs(playerMutexes).map(function(pair) {
  return mutex.and([
    pair[0],
    pair[1],
    mutex.or(gameBoardMutexes)
  ]).lock().then(function(mutexHandle) {
    var gameBoard = mutexHandle.resource[2]
    var playerA = mutexHandle.resource[0]
    var playerB = mutexHandle.resource[1]
    
    return gameBoard.play(playerA, playerB).then(mutexHandle.release)
  })
})).then(function() {
  console.log('Everyone finished playing everyone else')
})
