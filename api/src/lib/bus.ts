// Economy fork: single point that reaches the shared in-process bus, so the
// deep relative path lives in one file. Everything else imports `../lib/bus`.
export * from "../../../deploy/in-process-bus";
