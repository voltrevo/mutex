'use strict'

var mutex = exports

var once = function(f, extraCallValue) {
    var called = false

    return function() {
        if (!called) {
            called = true
            return f.apply(undefined, arguments)
        }

        return extraCallValue
    }
}

mutex.create = function(resource) {
    var self = {}

    var impl = {}
    self.impl = impl

    impl.resource = resource
    impl.locked = false
    impl.lockQueue = []

    self.isLocked = function() {
        return impl.locked
    }

    impl.unlock = function() {
        impl.locked = false
        impl.runQueue()
    }

    impl.createLock = function() {
        impl.locked = true

        return {
            resource: impl.resource,
            release: once(impl.unlock)
        }
    }

    self.tryLock = function() {
        return (impl.locked ? null : impl.createLock())
    }

    self.lock = function(condition) {
        condition = condition || function() { return true }

        return new Promise(function(resolve, reject) {
            var client = {
                condition: condition,
                resolve: resolve,
                reject: reject
            }

            if (!impl.locked) {
                impl.tryClient(client)
            } else {
                impl.lockQueue.push(client)
            }
        })
    }

    impl.tryClient = function(client) {
        impl.locked = true
        var accepted = client.condition()
        impl.locked = false

        if (accepted) {
            client.resolve(impl.createLock())
        } else {
            client.reject()
        }

        return accepted
    }

    impl.runQueue = function() {
        var accepted = false

        while (impl.lockQueue.length > 0 && accepted === false) {
            accepted = impl.tryClient(impl.lockQueue.shift())
        }
    }

    return self
}

mutex.empty = function() {
    var self = {}

    var impl = {}
    self.impl = impl

    impl.createLock = function() {
        return {
            resource: undefined,
            release: function() {}
        }
    }

    self.isLocked = function() { return false }
    self.tryLock = function() { return impl.createLock() }

    self.lock = function(condition) {
        condition = condition || function() { return true }

        return (
            condition() ?
            Promise.resolve(impl.createLock()) :
            Promise.reject('condition failed')
        )
    }

    return self
}()

mutex.and = function(mutexes) {
    var self = {}

    var impl = {}
    self.impl = impl

    impl.mutexes = mutexes
    impl.internalLocks = 0

    self.isLocked = function() {
        return impl.internalLocks === 0 && impl.mutexes.some(function(m) { return m.isLocked() })
    }

    impl.combineLocks = function(locks) {
        return {
            resource: locks.map(function(lock) { return lock.resource }),
            release: function() { locks.forEach(function(lock) { lock.release() }) }
        }
    }

    impl.createLock = function() {
        return impl.combineLocks(impl.mutexes.map(function(m) {
            return m.tryLock()
        }))
    }

    self.tryLock = function() {
        if (self.isLocked()) {
            return null
        }

        return impl.createLock()
    }

    self.lock = function(condition) {
        condition = condition || function() { return true }

        impl.internalLocks++

        return new Promise(function(resolve, reject) {
            if (impl.mutexes.length === 0) {
                resolve(impl.createLock())
            }

            var currMutexIndex = 0
            var locks
            var conditionFailed = false

            ;(function tryCurrMutex() {
                var currMutex = impl.mutexes[currMutexIndex]

                currMutex.lock(function() {
                    if (!impl.mutexes.some(function(m) {
                        return m !== currMutex && m.isLocked()
                    })) {
                        if (condition()) {
                            locks = impl.mutexes.map(function(m) { return m.tryLock() })
                            return true
                        } else {
                            conditionFailed = true
                        }
                    }

                    return false
                }).then(function(lock) {
                    locks[currMutexIndex] = lock
                    resolve(impl.combineLocks(locks))
                }).catch(function() {
                    if (conditionFailed) {
                        reject('condition failed')
                    } else {
                        currMutexIndex = (currMutexIndex + 1) % impl.mutexes.length
                        tryCurrMutex()
                    }
                })
            })()
        }).then(function(lock) {
            impl.internalLocks--
            return lock
        }, function() {
            impl.internalLocks--
        })
    }

    return self
}

mutex.or = function(mutexes) {
    var self = {}

    var impl = {}
    self.impl = impl

    impl.mutexes = mutexes
    impl.internalLocks = 0

    self.isLocked = function() {
        return impl.internalLocks === 0 && impl.mutexes.every(function(m) { return m.isLocked() })
    }

    self.tryLock = function() {
        if (impl.internalLocks !== 0) {
            return null
        }

        for (var i = 0; i !== impl.mutexes.length; i++) {
            var m = impl.mutexes[i]

            if (!m.isLocked()) {
                return m.tryLock()
            }
        }

        return null
    }

    self.lock = function(condition) {
        var attempt = self.tryLock()

        if (attempt) {
            return Promise.resolve(attempt)
        }

        condition = condition || function() { return true }
        condition = once(condition, false)

        impl.internalLocks++

        return Promise.race(
            impl.mutexes.map(function(m) {
                return m.lock(condition)
            })
        ).then(function(lock) {
            impl.internalLocks--
            return lock
        }, function() {
            impl.internalLocks--
        })
    }

    return self
}
