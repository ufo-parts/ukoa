const debug = require('debug')('ufo:checkResponse');

/**
 * 规范输出字段中间件
 * @param {*} ctx
 * @param {*} next
 */
const checkResponse = (options = {}) => async (ctx, next) => {
  await next();
  debug(`Req: ${JSON.stringify(ctx.body, null, '    ')}`);
  const { stdout, trigger, onlyController } = Object.assign({
    stdout: {
      Action: 1, RetCode: 1, Message: 1, Data: 1, TrackSN: 1, ChainSN: 1, Total: 1,
    },
    onlyController: true,
  }, options);

  // match api ctx
  if (!Array.isArray(ctx.body) && onlyController) {
    return;
  }
  if (Array.isArray(ctx.body)) {
    const [data, err, retOpt = {}] = ctx.body;
    const { total = 0, prefix = true, retcode } = retOpt;
    const prefixStr = prefix ? `${ctx.app.name} -> ` : '';
    ctx.body = {
      Action: `${ctx.mergeParams.Action || ''}Response`,
      RetCode: err ? retcode || -1 : 0,
      TrackSN: ctx.mergeParams.TrackSN,
      ChainSN: ctx.mergeParams.ChainSN,
      Data: err ? {} : data,
      Message: err ? `${prefixStr}${data}` : 'Ok!',
      Total: Object.prototype.toString.apply(data) === '[object Array]' ? total || data.length : undefined,
    };
  }
  if (typeof trigger === 'function') ctx.body = trigger(ctx.body);
  if (ctx.body) Object.keys(ctx.body).forEach((key) => { if (!stdout[key]) delete ctx.body[key]; });
  debug(`Res: ${JSON.stringify(ctx.body, null, '    ')}`);
};

module.exports = checkResponse;
