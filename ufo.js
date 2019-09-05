const assert = require('assert');
const path = require('path');
const KoaApplication = require('koa');
const Router = require('koa-router');
const compose = require('koa-compose');
const os = require('os');
const { get } = require('lodash');

const Consul = require('./server/utils/consul');
const helper = require('./server/utils/helper');
const logger = require('./server/utils/logger');
const CacheMap = require('./server/utils/cacheMap');
require('dotenv').config();

class Ufo extends KoaApplication {
  constructor({
    name,
    baseDir, apiDir, configDir, routerPrefix,
    consul_url, consul_token, consul_type, consul_category, consul_version,
    try_catch_url, try_catch_token,
  } = {}) {
    super();
    this.baseDir = baseDir || process.cwd(); // 系统根目录
    this.apiDir = apiDir || './server/api'; // API存放目录
    this.configDir = configDir || './server/config/.env.json'; // 配置文件存放目录
    this.tryCatchUrl = process.env.TRY_CATCH_URL || try_catch_url,
    this.tryCatchToken = process.env.TRY_CATCH_TOKEN || try_catch_token,
    this.name = name || consul_category,
    this.ip = get(os.networkInterfaces(), 'eth0[0].address', '127.0.0.1'),
    assert(typeof this.baseDir === 'string', 'ufo: base_dir must be a string!');
    this.helper = helper;
    this.dynamicMv = [];
    this.router = new Router({ prefix: process.env.ROUTER_PREFIX || routerPrefix });
    this.logger = logger(this);
    this.curl = async (url, data, config) => {
      const result = await require('./curl')(url, data, config, { logger: this.logger });
      return result;
    };
    this.ufoCurl = async (url, data, config) => {
      const result = await require('./ufoCurl')(url, data, config, { logger: this.logger });
      return result;
    };
    this.cacheMap = new CacheMap(this, 60 * 1000);

    // 服务发现注册
    this.consul = new Consul({
      consul_url: process.env.CONSUL_URL || consul_url,
      consul_token: process.env.CONSUL_TOKEN || consul_token,
      consul_type: process.env.CONSUL_TYPE || consul_type,
      consul_category: process.env.CONSUL_CATEGORY || consul_category,
      consul_version: process.env.CONSUL_VERSION || consul_version,
      env: this.env,
    });
  }

  // loadApi
  loadApi(actionPath = path.join(this.baseDir, this.apiDir), splitChar = '_', preArr) {
    this.apiMap = this.helper.requireFileMulti(actionPath, splitChar, preArr);
    return this;
  }

  // 中间件
  loadDefaultMv(options = {}) {
    this.use(require('./server/mv/systemCatch')(options.systemCatch));
    this.use(require('koa2-cors')(options['koa2-cors'] || { origin: ctx => ctx.headers.origin, credentials: true }));
    this.use(require('koa-json')(options['koa-json']));
    this.use(require('koa-bodyparser')(options['koa-bodyparser'] || { formLimit: '50mb', jsonLimit: '50mb' }));
    this.use(require('./server/mv/appWithCtx')(options.appWithCtx)); // ctx.app.ctx 将每次ctx带入app中
    this.use(require('./server/mv/changeRoutePath')(options.changeRoutePath)); // 根据action改变路由
    this.use(require('./server/mv/mergeParams')(options.mergeParams)); // 合并参数
    this.use(require('./server/mv/internalCall')(options.internalCall)); // 内部调用
    this.use(require('./server/mv/checkResponse')(options.checkResponse)); // 检查参数

    this.dynamicMv.push(
      require('./server/mv/checkOwnData')(options.checkOwnData || { enable: false, key: 'ownData' }),
      require('./server/mv/checkAction')(options.checkAction),
    );
    return this;
  }

  // 配置文件
  async init({ mv } = {}) {
    this.config = await require('./server/utils/config')({
      baseDir: this.baseDir,
      configDir: this.configDir,
      consul: this.consul,
      env: this.env,
      ip: this.ip,
      name: this.name,
    });
    await this.loadApi();
    this.loadDefaultMv(mv);
    return this;
  }

  // 新增动态路由中间价
  useDynamic(fn) {
    if (typeof fn !== 'function') throw new TypeError('useDynamic must be a function!');
    this.dynamicMv.push(fn);
    return this;
  }

  // start app
  async start() {
    // 路由
    this.router
      .get('/HeartBeat', require('./server/routers/heartBeat'))
      .get('/Restart', require('./server/routers/restart'))
      .all('/docs/:Action', require('./server/routers/docs'))
      .all('/dynamic/:Action', compose([].concat(
        this.dynamicMv,
        require('./server/routers/dynamicAction'),
      )));

    this
      .use(this.router.routes())
      .use(this.router.allowedMethods());

    // start app
    this.listen(this.config.port || 3000, async () => {
      // 服务注册
      if (this.env === 'production') await this.consul.ServiceRegistry(this.config);
      this.logger.info({
        api_env: `${this.config.api_env}`,
        api_url: `${this.config.api_ip}:${this.config.port}`,
        api_name: `${this.config.api_name}`,
      });
      this.logger.info('service start successful!');
    });
  }
}
process.on('uncaughtException', (e) => {
  logger().error(e);
});

process.on('unhandledRejection', (e) => {
  logger().error(e);
});

process.on('rejectionHandled', (e) => {
  logger().error(e);
});

module.exports = Ufo;
