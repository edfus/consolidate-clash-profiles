import pino from "pino";

// let winstonTransports = new transports.Console({
//   format: process.env.NODE_ENV !== 'production' 
//   && format.colorize({ all: true })
// });

// if (process.env.NODE_ENV !== 'production') {
//   winstonTransports = [
//     winstonTransports,
//     new transports.File({ filename: 'error.log', level: 'error' })
//   ]
// }

// const logger = pino({
//   level: 'info',
//   format: format.combine(
//     format.timestamp({
//       format: 'YYYY-MM-DD HH:mm:ss'
//     }),
//     format.errors({ stack: true }),
//     format.splat(),
//     format.json()
//   ),
//   defaultMeta: { service: 'your-service-name' },
//   transports: winstonTransports
// });

export default pino({ level: process.env.LOG_LEVEL || 'info' });