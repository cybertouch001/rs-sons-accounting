
// R&S Sons Accounting - core entry
const { Company, VTYPES } = require('./company');
require('./reports1'); require('./reports2'); require('./reports3'); require('./reports4'); require('./gst'); require('./automation'); require('./itr');
module.exports = { Company, VTYPES, util: require('./util'), calc: require('./calc') };
