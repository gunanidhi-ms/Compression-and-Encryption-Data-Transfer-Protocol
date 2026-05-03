const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { startServer } = require('./server');
const { startClient } = require('./client');

yargs(hideBin(process.argv))
    .command(
        'server',
        'Start the CETP WebRTC receiver server',
        (yargs) => {
            return yargs
                .option('pin', {
                    describe: '6-digit pairing PIN',
                    type: 'string',
                    default: null
                });
        },
        (argv) => {
            console.log(`Starting WebRTC Receiver...`);
            startServer(argv.pin);
        }
    )
    .command(
        'send <file>',
        'Send a file or folder to a CETP WebRTC server',
        (yargs) => {
            yargs
                .positional('file', {
                    describe: 'Path to file or folder to send',
                    type: 'string'
                })
                .option('pin', {
                    type: 'string',
                    description: '6-digit pairing PIN',
                    demandOption: true
                });
        },
        async (argv) => {
            try {
                await startClient(argv.file, argv.pin);
            } catch (err) {
                console.error("Transfer failed:", err.message);
                process.exit(1);
            }
        }
    )
    .demandCommand(1, 'You must provide a valid command (server or send)')
    .help()
    .parse();
