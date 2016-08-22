'use strict'
// const log = require('../util/log')

class TransferLog {

  constructor (store) {
    this._get = store.get
    this._put = store.put
    this._del = store.del
    this.incoming = 'i'
    this.outgoing = 'o'
  }

  get (transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        return Promise.resolve(JSON.parse(json).transfer)
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  getType (transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        return Promise.resolve(JSON.parse(json).type)
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  store (transfer, type) {
    return (this._put('t' + transfer.id, JSON.stringify({
      transfer: transfer,
      type: type
    })))
  }
  storeOutgoing (transfer) {
    return this.store(transfer, this.outgoing)
  }
  storeIncoming (transfer) {
    return this.store(transfer, this.incoming)
  }

  exists (transferId) {
    return this.get(transferId).then((storedTransfer) => {
      return Promise.resolve(storedTransfer !== undefined)
    })
  }

  del (transferId) {
    return this._del('t' + transferId)
  }

  complete (transferId) {
    // TODO: more efficient way of doing this
    return this._put('c' + transferId, 'complete')
  }

  isComplete (transferId) {
    return this._get('c' + transferId).then((data) => {
      return Promise.resolve(data !== undefined)
    })
  }

  fulfill (transferId, fulfillment) {
    // TODO: more efficient way of doing this
    return this._get('t' + transferId).then((json) => {
      const obj = Object.assign(JSON.parse(json), {fulfillment: fulfillment})
      return this._put('t' + transferId, JSON.stringify(obj))
    }).then(() => {
      return this._put('f' + transferId, 'complete')
    })
  }

  isFulfilled (transferId) {
    return this._get('f' + transferId).then((data) => {
      return Promise.resolve(data !== undefined)
    })
  }

  getFulfillment (transferId) {
    return this._get('t' + transferId).then((json) => {
      const obj = JSON.parse(json)
      return Promise.resolve(obj && obj.fulfillment) // can be undefined
    })
  }
}

exports.TransferLog = TransferLog
