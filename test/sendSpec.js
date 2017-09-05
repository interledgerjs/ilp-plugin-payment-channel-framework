'use strict'

const crypto = require('crypto')
const uuid = require('uuid4')
const ilpPacket = require('ilp-packet')
const clpPacket = require('clp-packet')
const base64url = require('base64url')

const sinon = require('sinon')
const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const expect = chai.expect

const ObjStore = require('./helpers/objStore')
const PluginPaymentChannel = require('..')
const MockSocket = require('./helpers/mockSocket')
const { protocolDataToIlpAndCustom, ilpAndCustomToProtocolData } =
  require('../src/util/protocolDataConverter')

const info = {
  prefix: 'example.red.',
  currencyCode: 'USD',
  currencyScale: 2,
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const peerAddress = 'example.red.client'
const options = {
  prefix: 'example.red.',
  token: 'placeholder',
  currencyCode: 'USD',
  currencyScale: 2,
  maxBalance: '1000000',
  minBalance: '-40',
  rpcUri: 'https://example.com/rpc',
  info: info
}

describe('Send', () => {
  beforeEach(function * () {
    options._store = new ObjStore()
    this.plugin = new PluginPaymentChannel(options)

    this.mockSocket = new MockSocket()
    this.plugin.addSocket(this.mockSocket)
    yield this.plugin.connect()

    this.ilpError = ilpPacket.serializeIlpError({
      code: 'F00',
      name: 'Bad Request',
      triggeredBy: '',
      forwardedBy: [],
      triggeredAt: new Date(),
      data: JSON.stringify({ message: 'Peer isn\'t feeling like it.' })
    })
  })

  afterEach(function * () {
    assert(yield this.mockSocket.isDone(), 'request handlers must have been called')
  })

  describe('RPC', () => {
    it('should throw an error on an error code', function () {
      const expectedRequestId = 1234
      this.mockSocket.reply(clpPacket.TYPE_MESSAGE, ({requestId, data}) => {
        assert.equal(requestId, expectedRequestId)
        return clpPacket.serializeError({rejectionReason: this.ilpError}, requestId, [])
      })

      const cllpMessage = clpPacket.serializeMessage(expectedRequestId, [])
      return expect(this.plugin._rpc._call(expectedRequestId, cllpMessage))
        .to.eventually.be.rejected
    })

    // TODO: reassess whether this test case is still necessary (cc: sharafian)
    it.skip('should send authorization bearer token', function () {
      // nock('https://example.com', {
      //   reqheaders: {
      //     'Authorization': 'Bearer ' + this.plugin._getAuthToken()
      //   }
      // })
      //   .post('/rpc?method=method&prefix=example.red.', [])
      //   .reply(200, { a: 'b' })

      return expect(this.plugin._rpc.call('method', 'example.red.', []))
        .to.eventually.deep.equal({ a: 'b' })
    })

    // TODO: reassess whether this test case is still necessary (cc: sharafian)
    it.skip('should accept an object as a response', function () {
      // nock('https://example.com')
      //   .post('/rpc?method=method&prefix=example.red.', [])
      //   .reply(200, {
      //     a: {
      //       b: 'c'
      //     }
      //   })

      return expect(this.plugin._rpc.call('method', 'example.red.', []))
        .to.eventually.deep.equal({
          a: {
            b: 'c'
          }
        })
    })
  })

  // TODO: define how sendRequest should work (cc: @sharafian)
  describe('sendRequest', () => {
    beforeEach(function * () {
      this.message = {
        // TODO: from, to, ledger do not exist in CLP. Can these fields be removed? (@sharafian)
        from: this.plugin.getAccount(),
        to: peerAddress,
        ledger: this.plugin.getInfo().prefix,
        ilp: base64url('some_base64_encoded_data_goes_here'),
        custom: {
          field: 'some stuff'
        }
      }

      this.response = {
        // TODO: from, to, ledger do not exist in CLP. Can these fields be removed? (@sharafian)
        from: peerAddress,
        to: this.plugin.getAccount(),
        ledger: this.plugin.getInfo().prefix,
        ilp: base64url('some_other_base64_encoded_data_goes_here'),
        custom: {
          field: 'some other stuff'
        }
      }
    })

    it('should send a request', function * () {
      this.mockSocket.reply(clpPacket.TYPE_MESSAGE, ({requestId, data}) => {
        const {ilp, custom} = protocolDataToIlpAndCustom(data)
        assert.equal(ilp, this.message.ilp)
        assert.deepEqual(custom, this.message.custom)

        return clpPacket.serializeResponse(requestId,
          ilpAndCustomToProtocolData(this.response))
      })

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_request', resolve))
      const incoming = new Promise((resolve) => this.plugin.on('incoming_response', resolve))

      const response = yield this.plugin.sendRequest(this.message)
      yield outgoing
      yield incoming

      assert.equal(response.ilp, this.response.ilp)
      assert.deepEqual(response.custom, this.response.custom)
    })

    it('should respond to a request', function * () {
      // TODO: reassess wheter .to and .from are still necessary
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      this.plugin.registerRequestHandler((request) => {
        assert.equal(request.ilp, this.message.ilp)
        assert.deepEqual(request.custom, this.message.custom)
        return Promise.resolve(this.response)
      })

      this.mockSocket.reply(clpPacket.TYPE_RESPONSE, ({requestId, data}) => {
        const {ilp, custom} = protocolDataToIlpAndCustom(data)
        assert.equal(ilp, this.response.ilp)
        assert.deepEqual(custom, this.response.custom)
      })

      const incoming = new Promise((resolve) => this.plugin.on('incoming_request', resolve))
      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_response', resolve))

      const clpMessage = clpPacket.serializeMessage(1111,
        ilpAndCustomToProtocolData(this.message))
      yield this.plugin._rpc.handleMessage(this.mockSocket, clpMessage)

      yield incoming
      yield outgoing
    })

    it('should return an ILP error if the request handler errors', function * () {
      // TODO: reassess wheter .to and .from are still necessary
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      this.plugin.registerRequestHandler((request) => {
        return Promise.reject(new Error('this is an error'))
      })

      this.mockSocket.reply(clpPacket.TYPE_RESPONSE, ({data}) => {
        const {ilp} = protocolDataToIlpAndCustom(data)
        const error = ilpPacket.deserializeIlpError(Buffer.from(ilp, 'base64'))
        assert.equal(error.code, 'F00')
        assert.equal(error.name, 'Bad Request')
        assert.equal(error.triggeredBy, this.plugin.getAccount())
        assert.deepEqual(error.forwardedBy, [])
        assert.deepEqual(JSON.parse(error.data), { message: 'this is an error' })
      })

      const clpMessage = clpPacket.serializeMessage(1111,
        ilpAndCustomToProtocolData(this.message))
      yield this.plugin._rpc.handleMessage(this.mockSocket, clpMessage)
    })

    it('should throw an error if a handler is already registered', function * () {
      this.plugin.registerRequestHandler(() => {})
      assert.throws(() => this.plugin.registerRequestHandler(() => {}),
        /requestHandler is already registered/)
    })

    it('should throw an error if no handler is registered', function * () {
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      assert.isNotOk(this.plugin._requestHandler, 'handler should not be registered yet')

      this.plugin.registerRequestHandler((request) => {
        assert.deepEqual(request, this.message)
        return Promise.resolve(this.response)
      })

      this.plugin.deregisterRequestHandler()

      const clpMessage = clpPacket.serializeMessage(1111,
        ilpAndCustomToProtocolData(this.message))
      yield expect(this.plugin._rpc.handleMessage(this.mockSocket, clpMessage))
        .to.be.rejectedWith(/no request handler registered/)
    })

    it('should throw an error on no response', function * () {
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout'] })

      this.mockSocket.reply(clpPacket.TYPE_MESSAGE, () => {
        // sending no response back triggers a timeout on the sending side
        clock.tick(10000)
      })

      return expect(this.plugin.sendRequest(this.message)).to.eventually.be.rejected
    })

    it('should not send without an account or to-from', function () {
      this.message.account = undefined
      this.message.to = undefined
      this.message.from = undefined

      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/must have a destination/)
    })

    it('should not send with incorrect ledger', function () {
      this.message.ledger = 'bogus'
      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/ledger .+ must match ILP prefix/)
    })
  })

  describe('sendTransfer (log and balance logic)', () => {
    beforeEach(function * () {
      this.fulfillment = require('crypto').randomBytes(32)
      this.transfer = {
        id: uuid(),
        ledger: this.plugin.getInfo().prefix,
        from: this.plugin.getAccount(),
        to: peerAddress,
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        amount: '5',
        custom: {
          field: 'some stuff'
        },
        executionCondition: base64url(crypto
          .createHash('sha256')
          .update(this.fulfillment)
          .digest())
      }

      this.clpTransfer = clpPacket.serializePrepare(
        Object.assign({}, this.transfer, {transferId: this.transfer.id}),
        12345, // requestId
        ilpAndCustomToProtocolData(this.transfer)
      )
      this.clpFulfillment = clpPacket.serializeFulfill({
        transferId: this.transfer.id,
        fulfillment: this.fulfillment
      }, 98765, [])
    })

    it('should send a transfer', async function () {
      this.mockSocket.reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
        assert.equal(data.transferId, this.transfer.id)
        assert.equal(data.amount, +this.transfer.amount)
        assert.equal(data.executionCondition, this.transfer.executionCondition)
        assert.equal(data.expiresAt.getTime(),
          new Date(this.transfer.expiresAt).getTime())
        const {custom} = protocolDataToIlpAndCustom(data)
        assert.deepEqual(custom, this.transfer.custom)

        return clpPacket.serializeResponse(requestId, [])
      })

      const sent = new Promise((resolve) => this.plugin.on('outgoing_prepare', resolve))
      await this.plugin.sendTransfer(this.transfer)
      await sent

      // TODO: @sharafian, when is the balance supposed to be updated?
      // At the moment, a call to sendTransfer does not update the balance, see below:
      // await new Promise(async (resolve, reject) => {
      //   setTimeout(async () => {
      //     const balance = await this.plugin.getBalance()
      //     console.log('balance', balance)
      //     resolve()
      //   }, 200)
      // })
    })

    it.skip('should roll back a transfer if the RPC call fails', async function () {
      this.mockSocket.reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
        return clpPacket.serializeError({rejectionReason: this.ilpError},
          requestId, [])
      })

      try {
        // TODO: @sharafian, this test case seems to not have worked as intended,
        // because sendTransfer did not throw. Any reason why sendTransfer only
        // throws if the plugin is stateful?
        await this.plugin.sendTransfer(this.transfer)
        assert.fail('should throw')
      } catch (err) {
        assert.match(err.message, /Unexpected status code 500/)
      }
      // TODO: At the moment, the balance is not update indepently if the RPC call
      // fails or not (see test case 'should send a transfer')
      assert.equal((await this.plugin.getBalance()), '0', 'balance should be rolled back')
    })

    it('should receive a transfer', function * () {
      const received = new Promise((resolve, reject) => {
        this.plugin.on('incoming_prepare', (transfer) => {
          try {
            assert.deepEqual(transfer, this.transfer)
          } catch (e) {
            reject(e)
          }
          resolve()
        })
      })

      this.transfer.from = peerAddress
      this.transfer.to = this.plugin.getAccount()

      this.mockSocket.reply(clpPacket.TYPE_RESPONSE)

      yield this.plugin._rpc.handleMessage(this.mockSocket, this.clpTransfer)
      yield received
    })

    it('should not race when reading the balance', function * () {
      const transfer2 = Object.assign({}, this.transfer, { id: uuid() })
      const fulfillment2 = clpPacket.serializeFulfill({
        transferId: transfer2.id,
        fulfillment: this.fulfillment
      }, 98765, [])

      this.mockSocket
        .reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
          return clpPacket.serializeResponse(requestId, [])
        })
        .reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
          return clpPacket.serializeResponse(requestId, [])
        })
        .reply(clpPacket.TYPE_RESPONSE)
        .reply(clpPacket.TYPE_RESPONSE)

      yield this.plugin.sendTransfer(this.transfer)
      yield this.plugin.sendTransfer(transfer2)

      const send1 = this.plugin._rpc.handleMessage(this.mockSocket, this.clpFulfillment)
      const send2 = this.plugin._rpc.handleMessage(this.mockSocket, fulfillment2)

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-10',
        'both transfers should be applied to the balance')
    })

    it('should not apply twice when two identical transfers come in with the same id', function * () {
      this.mockSocket
        .reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
          return clpPacket.serializeResponse(requestId, [])
        })
        .reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
          return clpPacket.serializeResponse(requestId, [])
        })
        .reply(clpPacket.TYPE_ERROR)
        .reply(clpPacket.TYPE_RESPONSE)

      yield this.plugin.sendTransfer(this.transfer)
      yield this.plugin.sendTransfer(this.transfer)

      const send1 = this.plugin._rpc.handleMessage(this.mockSocket, this.clpFulfillment)
      const send2 = this.plugin._rpc.handleMessage(this.mockSocket, this.clpFulfillment)
        .catch((e) => {})

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-5',
        'only one of the transfers should be applied to the balance')
    })

    it('should not race when two different transfers come in with the same id', function * () {
      this.mockSocket
        .reply(clpPacket.TYPE_PREPARE, ({requestId, data}) => {
          return clpPacket.serializeResponse(requestId, [])
        })

      const transfer2 = Object.assign({}, this.transfer, { amount: '10' })

      const send1 = this.plugin.sendTransfer(this.transfer)
      const send2 = this.plugin.sendTransfer(transfer2)

      // one of these should be rejected because they are two transfer with the
      // same ID but different data
      yield expect(Promise.all([ send1, send2 ]))
        .to.eventually.be.rejectedWith(/transfer .* matches the id of .* but not the contents/)
    })

    it('should not send a transfer without id', function () {
      this.transfer.id = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid id', function () {
      this.transfer.id = 666
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer without to', function () {
      delete this.transfer.to
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid to', function () {
      this.transfer.to = '$$$ cawiomdaAW ($Q@@)$@$'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with a non-string to', function () {
      this.transfer.to = 42
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-object data', function () {
      this.transfer.data = 9000
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with no amount', function () {
      this.transfer.amount = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-number amount', function () {
      this.transfer.amount = 'bogus'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with amount over limit', function () {
      this.transfer.amount = '50.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with negative amount', function () {
      this.transfer.amount = '-5.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })
  })

  // TODO: @sharafian, do we still need these tests? We removed sendMessage()
  // from plugin.js
  describe.skip('sendMessage (legacy)', () => {
    beforeEach(function * () {
      this.message = {
        from: this.plugin.getAccount(),
        to: peerAddress,
        ledger: this.plugin.getInfo().prefix,
        data: {
          field: 'some stuff'
        }
      }
    })

    it('should send a message', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_message&prefix=example.red.', [this.message])
        .reply(200, true)

      // this.mockSocket.reply(clpPacket.TYPE_MESSAGE, ({requestId, data}) => {
      //   return clpPacket.serializeResponse(requestId, [])
      // })

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_message', resolve))
      yield this.plugin.sendMessage(this.message)
      yield outgoing
    })

    it('should receive a message', function * () {
      this.message.from = peerAddress
      this.message.to = this.plugin.getAccount()
      this.message.account = this.plugin.getAccount()

      const incoming = new Promise((resolve, reject) => {
        this.plugin.on('incoming_message', (message) => {
          try {
            assert.deepEqual(message, Object.assign({},
              this.message,
              { account: peerAddress }))
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      assert.isTrue(yield this.plugin._rpc.handleMessage('send_message', [this.message]))
      yield incoming
    })

    it('should throw an error on no response', function () {
      this.timeout(3000)
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send without an account or to-from', function () {
      this.message.account = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with incorrect ledger', function () {
      this.message.ledger = 'bogus'
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with missing ledger', function () {
      this.message.ledger = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send without any data', function () {
      this.message.data = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })
  })
})
