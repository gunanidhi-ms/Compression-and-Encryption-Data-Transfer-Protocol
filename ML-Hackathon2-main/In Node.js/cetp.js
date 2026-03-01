const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { startServer } = require('./server');
const { startClient } = require('./client');

yargs(hideBin(process.argv))
    .command(
        'server',
        'Start the CETP HTTPS receiver server',
        (yargs) => {
            return yargs
                .option('port', {
                    alias: 'p',
                    describe: 'Port to bind on',
                    default: 8888,
                    type: 'number'
                })
                .option('pin', {
                    describe: '6-digit pairing PIN',
                    type: 'string',
                    default: null
                })
                .option('host', {
                    describe: 'Host to bind on',
                    default: '0.0.0.0',
                    type: 'string'
                });
        },
        (argv) => {
            console.log(`Starting HTTPS Server on ${argv.host}:${argv.port}...`);
            startServer(argv.port, argv.pin, argv.host);
        }
    )
    .command(
        'send <file>',
        'Send a file or folder to a CETP HTTPS server',
        (yargs) => {
            yargs
                .positional('file', {
                    describe: 'Path to file or folder to send',
                    type: 'string'
                })
                .option('ip', {
                    alias: 'h',
                    type: 'string',
                    description: 'Server IP address',
                    default: 'localhost'
                })
                .option('port', {
                    alias: 'p',
                    type: 'number',
                    description: 'Server port',
                    default: 8888
                })
                .option('pin', {
                    type: 'string',
                    description: '6-digit pairing PIN',
                    default: null
                });
        },
        async (argv) => {
            try {
                await startClient(argv.file, argv.ip, argv.port, argv.pin);
            } catch (err) {
                console.error("Transfer failed:", err.message);
                process.exit(1);
            }
        }
    )
    .demandCommand(1, 'You must provide a valid command (server or send)')
    .help()
    .parse();
