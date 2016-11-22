// mock require the network connection
const mockRequire = require('mock-require')
const mock =
  require('../mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire(
  '../../src/model/connection',
  MockConnection
)

const newObjStore = require('../helpers/objStore')
const store1 = newObjStore()
const store2 = newObjStore()

// This field contains the constructor for a plugin
exports.plugin = require('../..')

// This specifies the number of time in seconds that the plugin needs in order
// to fulfill a transfer (from send until fulfillment goes through).
exports.timeout = 0.2

// the shared secret that will be generated, needed in order to make ILP addresses
// to send to.
const token = 'FJC2v38LZNMU8IxwJftvzU3yHwT/W3YmAsodzxNk0AA'

// These objects specify the configs of different
// plugins. There must be 2, so that they can send
// transfers to one another.
exports.options = [
  // options for the first plugin
  {
    // These are the PluginOptions passed into the plugin's
    // constructor.
    'pluginOptions': {
      'secret': 'noob_secret',
      'peerPublicKey': 'fkqDV7mm5H29Cd8Q51itbSS6JR3ApdOlS14Po5I1CAc',
      'prefix': 'test.nerd.',
      'account': 'nerd',
      'broker': 'ws://broker.hivemq.com:8000',
      'maxBalance': '1000',
      'other': {
        'channels': MockChannels,
        'name': 'noob'
      },
      'info': {
        'currencyCode': 'USD',
        'currencySymbol': '$',
        'precision': 15,
        'scale': 15,
        'connectors': [ { id: 'other', name: 'other', connector: 'peer.other' } ]
      },
      '_store': store1
    },
    // These objects are merged with transfers originating from
    // their respective plugins. Should specify the other plugin's
    // account, so that the two plugins can send to one another
    'transfer': {
      'account': 'peer.' + token.substring(0, 5) + '.fkqDV7mm5H29Cd8Q51itbSS6JR3ApdOlS14Po5I1CAc'
    }
  },
  // options for the second plugin
  {
    'pluginOptions': {
      'secret': 'nerd_secret',
      'peerPublicKey': 'mOFhdaec9GU5GleNZm3eihSizQd4MxScB8lp8yqEbTw',
      'prefix': 'test.nerd.',
      'broker': 'ws://broker.hivemq.com:8000',
      'maxBalance': '1000',
      'other': {
        'channels': MockChannels,
        'name': 'nerd'
      },
      'info': {
        'currencyCode': 'USD',
        'currencySymbol': '$',
        'precision': 15,
        'scale': 15,
        'connectors': [ { id: 'other', name: 'other', connector: 'peer.other' } ]
      },
      '_store': store2
    },
    'transfer': {
      'account': 'peer.' + token.substring(0, 5) + '.mOFhdaec9GU5GleNZm3eihSizQd4MxScB8lp8yqEbTw'
    }
  }
]
