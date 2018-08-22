'use strict';

const require_directory = require('require-dir');
const controllers = require_directory('./controllers', { recurse: true });
const config = require('config');
//var require_directory = require('require-directory');
//var controllers = require_directory(module, './controllers');
const verify_jwt = require('../middlewares/verify_jwt');
const check_jwt = require('../middlewares/check_jwt');
const key = config.get('main.jwt.key');
//const models = require('../models');

const router = require('logoran-joi-router');
const Joi = router.Joi;

const routers = router();

const verify = verify_jwt(key);
const check = check_jwt(key);
const admin_verify = verify_jwt(key, true);

const input_to_map = require('../middlewares/input_to_map');
const output_from_map = require('../middlewares/output_from_map');
const direct = require('../middlewares/direct');
const output_each = require('../middlewares/output_each');
const handlers = require_directory('./handlers',{recurse:true});

async function waittime() {
    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            console.log('after 15 secend');
            resolve(false);
        }, 10000);
    });
};

//修改子对象的存在属性方法
//方法1：指定修改const my_province = Joi.object(province).optionalKeys('name');缺点对象已经是Joi的对象,不是原始对象
//方法2：自己手动调用添加optional,required,forbidden,ignore等检查,优点还是原始的对象
//方法3：完全覆盖const my_province = Joi.object(province).keys({name: ...})
//方法4：给没有明确指定存在属性的域添加默认存在属性const my_province = Joi.object(province).options({presence: 'required'});
//删除对象检查方法1：通过const my_province = Joi.object(province).forbiddenKeys('name')模拟删除其实为禁用
//删除对象检查方法2：通过找到需要的对象加入对象const schema = Joi.object({ foo: Joi.object({ bar: Joi.number() }) });const number = Joi.reach(schema, 'foo.bar');
//在老的检查上添加新的检查：const a = Joi.string().valid('a');const b = Joi.string().valid('b');const ab = a.concat(b);
//最终方案：删除用自己的方法，修改属性使用XXXXKeys方法，只通过原始对象获取键值，某些场合可以使用options设定来进行操作
//访问方式：POST：用于新建提交，GET：用于获取，PUT：用于完整修改提交，PATCH：用于部分修改提交，DELETE：用于删除

//获取对象的键值，支持原生对象和Joi对象
function enumerateKeys(obj, recursive) {
    recursive = recursive || false;

    function _enumerateKeys(obj, recursive, isjoi) {
        recursive = ('undefined' == typeof recursive) ? true : recursive;
        isjoi = ('undefined' == typeof isjoi) ? false : isjoi;
        const keys = [];
        const children = obj && obj._inner && obj._inner.children;
        if (Array.isArray(children)) {
            children.forEach(function(child) {
                keys.push(child.key);
                if (recursive) {
                    _enumerateKeys(child.schema, recursive, true)
                        .forEach(function(k) { keys.push(child.key + '.' + k) });
                }
            })
        } else if (!isjoi) {
            for (let key in obj) {
                keys.push(key);
                if (recursive) {
                    _enumerateKeys(obj[key], recursive)
                        .forEach(function(k) { keys.push(key + '.' + k) });
                }
            }
        }
        return keys;
    }
    return _enumerateKeys(obj, recursive);
}

//返回对象的除指定键值以外的对象，支持原生对象和Joi对象
function removeKeys(obj, keys) {
    let old_key = enumerateKeys(obj, false);
    const children = obj && obj._inner && obj._inner.children;
    if (Array.isArray(children)) {
        let ret = {};
        old_key.forEach(function(k) {
            if (-1 == keys.indexOf(k)) {
                ret[k] = Joi.reach(obj, k);
            }
        });
        return Joi.object(ret);
    } else {
        let ret = {};
        old_key.forEach(function(k) {
            if (-1 == keys.indexOf(k)) {
                ret[k] = obj[k];
            }
        });
        return ret;
    }
}

//返回对象指定键值的对象，支持原生对象和Joi对象
function reachKeys(obj, keys) {
    const children = obj && obj._inner && obj._inner.children;
    if (Array.isArray(children)) {
        let ret = {};
        keys.forEach(function(k) {
            ret[k] = Joi.reach(obj, k);
        });
        return Joi.object(ret);
    } else {
        let ret = {};
        keys.forEach(function(k) {
            ret[k] = obj[k];
        });
        return ret;
    }
}

function removeAttributes(attributes, arr) {
    let ret = [];
    attributes.forEach(function(k) {
        if (-1 == arr.indexOf(k)) {
            ret.push(k);
        }
    });
    return ret;
}

function delete_property(obj, keys) {
    for (var key of keys) {
        delete obj[key];
    }
    return obj;
}

function add_time_info(info) {
    return Object.assign({
        created_at: Joi.date().required(), //创建时间
        updated_at: Joi.date().required() //更新时间
    }, info);
}

//错误信息
const error_info = {
    code: Joi.number().integer().required(), //错误码
    message: Joi.string().required() //错误信息
};

//用户信息
const user = {
    id: Joi.number().integer(), //用户编号
    name: Joi.string().min(3).max(50), //用户名
    email: Joi.string().max(255).email().allow(null), //全局唯一邮箱,可以用于登录
    business_id: Joi.number().integer().allow(null), //对应的商务信息编号
    account_id: Joi.number().integer().allow(null), //对应的财务信息编号，有的子帐号不独立记账，有的是独立记账的
    status: Joi.string().valid(['0', '1','2', '3', 0, 1,2,3]).default(0), //状态,0正常,1被冻结,2用户自行注销,3被永久冻结
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
};


const user_for_change = delete_property(Object.assign({}, user), ['id', 'created_at', 'updated_at']);

//用户个人详细信息
const user_info = {
    real_name: Joi.string().max(255).required(), //用户真实姓名
    phone: Joi.string().max(20).required(), //用户电话
    qq: Joi.string().max(20).required(), //用户QQ号
    gender: Joi.string().replace('female', '1').replace('male', '0').valid(['0', '1', 0, 1]).allow(null), //性别
    birthday: Joi.date().allow(null), //出生日期
    company: Joi.string().max(100).allow(null), //公司名称
    department: Joi.string().max(100).allow(null), //部门名称
    title: Joi.string().max(255).allow(null), //头衔
    office_addr: Joi.string().max(255).allow(null), //办公地址
    office_phone: Joi.string().max(20).allow(null), //办公电话
    office_fax: Joi.string().max(20).allow(null), //办公传真
    office_post: Joi.string().max(20).allow(null), //办公邮编
    home_addr: Joi.string().max(255).allow(null), //家庭地址
    home_phone: Joi.string().max(20).allow(null), //家庭电话
    home_post: Joi.string().max(20).allow(null), //家庭邮编
    homepage: Joi.string().max(255).allow(null), //主页
    memo: Joi.string().max(255).allow(null) //座右铭
};

//用户个人详细信息加时间
const user_info_with_time = add_time_info(user_info);

const user_info_for_change = Object.assign({}, user_info, {
    real_name: Joi.string().max(255), //用户真实姓名
    phone: Joi.string().max(20), //用户电话
    qq: Joi.string().max(20) //用户QQ号
});

//用户类型信息
const user_type = {
    id: Joi.number().integer().required(), //类型编号
    name: Joi.string().max(20).required(), //类型名称
    description: Joi.string().max(255).allow(null) //类型描述
};

const user_type_with_time = add_time_info(user_type);

//用户类型等级信息
const user_level_type = {
    type_id: Joi.number().integer().required(), //用户类型
    level: Joi.number().integer().required(), //用户等级
    parent_id: Joi.number().integer().allow(null), //上级用户
    updated_at: Joi.date().allow(null) //最后修改时间
};

//用户来源信息
const user_origin_type = {
    id: Joi.number().integer(), //编号
    name: Joi.string().min(3).max(50), //来源名称
    description: Joi.string().max(255).email().allow(null) //来源描述
};

//用户帐户信息
const user_account = {
    user_id: Joi.number().integer().required(), //用户编号
    balance: Joi.number().required(), //用户账户金额
    realtime_balance: Joi.number().required(), //用户的实时余额
    real_balance: Joi.number().allow(null) , //用户实际金额
    credit_limit: Joi.number().required(), //可用信用额度
    updated_at: Joi.date().allow(null) //最后修改时间
};
const user_account_for_create = delete_property(Object.assign({}, user_account), ['updated_at']);
const user_account_for_change = {
    balance: Joi.number().required(), //用户账户金额
	credit_limit: Joi.number().required() //可用信用额度
};

//用户业务表
const user_business_info = {
    user_id: Joi.number().integer().required(), //用户编号
    tag: Joi.string().max(50).required(), //用户简称
    name: Joi.string().max(255).required(), //用户全称
    type_id: Joi.number().integer().required(), //用户类型 [来自于用户类型表 0 普通用户 1代理用户]
    origin_type_id: Joi.number().integer().required(), //用户来源   [1:自行寻找 2：平台推荐  3：内部推荐  4：网站注册]
    level: Joi.number().integer().required(), //用户等级
    pay_type_id: Joi.string().replace('cash', '0').replace('nday', '1').replace('day', '2').replace('week', '3').replace('month', '4').valid(['0', '1', '2', '3','4', 0, 1, 2, 3, 4]).default(0), //结算模式
    pay_interval: Joi.number().integer().required(), //支付周期
    pay_started_at: Joi.date().allow(null), //起始支付时间
    station_id: Joi.number().integer().required(), //归属站点编号
    company_id: Joi.number().integer().allow(null), //归属公司编号
    business_waiter: Joi.number().integer().required(), //业务员
    customer_waiter: Joi.number().integer().required(), //客服员
    payment_waiter: Joi.number().integer().required(), //结算员
    fetch_waiter: Joi.number().integer().required(), //提货员
    status: Joi.string().replace('offical', '0').replace('temp', '1').valid(['0', '1', 0, 1]), //状态，0正式，1临时
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const user_business_info_with_name = Object.assign({
    user: { name: Joi.string().max(50).required() }
}, user_business_info);

const user_business_info_for_change = {
    user_id: Joi.number().integer().allow(null), //用户编号
    tag: Joi.string().max(50).allow(null), //用户简称
    name: Joi.string().max(255).allow(null), //用户全称
    type_id: Joi.number().integer().allow(null), //用户类型 [来自于用户类型表 0 普通用户 1代理用户]
    origin_type_id: Joi.number().integer().allow(null), //用户来源   [1:自行寻找 2：平台推荐  3：内部推荐  4：网站注册]
    level: Joi.number().integer().allow(null), //用户等级
    pay_type_id: Joi.string().replace('cash', '0').replace('nday', '1').replace('day', '2').replace('week', '3').replace('month', '4').valid(['0', '1', '2', '3','4', 0, 1, 2, 3, 4]).allow(null), //结算模式
    pay_interval: Joi.number().integer().allow(null), //支付周期
    pay_started_at: Joi.date().allow(null), //起始支付时间
    station_id: Joi.number().integer().allow(null), //归属站点编号
    company_id: Joi.number().integer().allow(null), //归属公司编号
    business_waiter: Joi.number().integer().allow(null), //业务员
    customer_waiter: Joi.number().integer().allow(null), //客服员
    payment_waiter: Joi.number().integer().allow(null), //结算员
    fetch_waiter: Joi.number().integer().allow(null), //提货员
    status: Joi.string().replace('offical', '0').replace('temp', '1').valid(['0', '1', 0, 1]).allow(null), //状态，0正式，1临时
};

const user_business_info_for_create = delete_property(Object.assign({}, user_business_info), ['user_id', 'created_at', 'updated_at']);
//const user_business_info_with_time = add_time_info(user_business_info);
//基础地址信息
const address_base = {
    id: Joi.number().integer().required(), //编号
    user_id: Joi.number().integer().required(), //用户编号
    name: Joi.string().max(50).required(), //姓名
    country: Joi.string().max(50).allow(null), //国家名字
    country_mark: Joi.string().max(20).allow(null), //国家二字码
    country_id: Joi.number().integer().required(), //国家编号
    province: Joi.string().max(100).allow(null), //省州名字
    province_id: Joi.number().integer().allow(null), //省州编号
    city: Joi.string().max(100).allow(null), //城市名称
    city_id: Joi.number().integer().allow(null), //城市编号
    county: Joi.string().max(255).allow(null), //区县街道名字,可以为多级["余杭","仓前"]
    county_id: Joi.number().integer().allow(null), //区县街道编号
    address: Joi.string().max(255).required(), //详细地址
    company: Joi.string().max(100).allow(null), //公司名称
    department: Joi.string().max(100).allow(null), //部门名称
    phone: Joi.string().max(20).allow(null), //电话
    mobile: Joi.string().max(20).allow(null), //手机
    postcode: Joi.string().max(20).allow(null), //邮编
    is_default: Joi.boolean().truthy(['Y', 'yes', '1', 1]).falsy(['N', 'no', '0', 0]).allow(null), //否默认地址
};

//发件地址信息
const send_address = Object.assign({
    identity: Joi.string().max(20).allow(null), //身份信息
}, address_base);

const send_address_for_change = delete_property(Object.assign({}, send_address), ['id', 'user_id']);

const send_address_with_time = add_time_info(send_address);

//收件地址信息
const receive_address = Object.assign({}, address_base);

const receive_address_for_change = delete_property(Object.assign({}, receive_address), ['id', 'user_id']);

const receive_address_with_time = add_time_info(receive_address);

//国家信息
const country = {
    id: Joi.number().integer().required(), //国家编号
    name: Joi.string().max(50).required(), //国家英文全称
    mark: Joi.string().max(20).allow(null), //国家英文简称
    alias: Joi.string().max(500).allow(null).allow(''), //别名
    name_cn: Joi.string().max(50).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //国家拼音
    name_local: Joi.string().max(50).allow(null), //本地名称
    has_province: Joi.boolean().truthy(['Y', 'yes', '0', 1]).falsy(['N', 'no', '0', 0]).allow(null), //是否管辖省州,或直接管辖城市
    code: Joi.string().max(10).allow(null), //国家代码，例:大陆86
    area: Joi.string().max(20).allow(null) //国家所在大洲
};

const country_for_change = delete_property(Object.assign({}, country), ['id', 'pinyin']);

//省州信息
const province = {
    id: Joi.number().integer().required(), //省州编号
    name: Joi.string().max(100).required(), //省州英文名称
    name_cn: Joi.string().max(100).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //省州拼音
    name_local: Joi.string().max(100).allow(null), //本地名称
    country_id: Joi.number().integer().required() //所属国家编号
};

const province_for_change = delete_property(Object.assign({}, province), ['id', 'pinyin', 'country_id']);

//城市信息
const city = {
    id: Joi.number().integer().required(), //城市编号
    name: Joi.string().max(100).required(), //城市英文名称
    name_cn: Joi.string().max(100).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //城市拼音
    name_local: Joi.string().max(100).allow(null), //本地名称
    code: Joi.string().max(10).allow(null), //城市代码，例:杭州0571
    country_id: Joi.number().integer().required(), //所属国家编号
    province_id: Joi.number().integer().required() //所属省州编号
};

const city_for_change = delete_property(Object.assign({}, city), ['id', 'pinyin', 'country_id']);

//区县乡镇街道信息
const county = {
    id: Joi.number().integer().required(), //城市编号
    name: Joi.string().max(100).required(), //城市英文名称
    name_cn: Joi.string().max(100).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //城市拼音
    name_local: Joi.string().max(100).allow(null), //本地名称
    full_name: Joi.string().max(255).required(), //完整英文全称
    full_name_cn: Joi.string().max(255).allow(null), //完整中文全称
    city_id: Joi.number().integer().required(), //所属城市编号
    super_id: Joi.number().integer().allow(null) //所属上级区县编号
};

const county_for_change = delete_property(Object.assign({}, county), ['id', 'pinyin', 'city_id']);

//统一地址信息
const united_address = {
    id: Joi.number().integer().required(), //统一地址编号
    name: Joi.string().max(50).required(), //地址英文全称
    mark: Joi.string().max(20).allow(null), //地址英文简称
    name_cn: Joi.string().max(50).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //拼音
    name_local: Joi.string().max(50).allow(null), //本地名称
    code: Joi.string().max(10).allow(null), //国家代码，例:大陆86
    area: Joi.string().max(20).allow(null) //所在大洲
};

//邮编信息
const postcode = {
    id: Joi.number().integer().required(), //编号
    code: Joi.string().max(20).required(), //邮编，例:杭州310000
    country_id: Joi.number().integer().required(), //所属国家编号
    city_id: Joi.number().integer().required(), //所属城市编号
    county_id: Joi.number().integer().allow(null) //所属区县编号
};

//渠道偏远信息
const remote = {
    id: Joi.number().integer().required(), //编号
    channel_id: Joi.number().integer().required(), //所有渠道编号
    country_id: Joi.number().integer().required(), //所属国家编号
    min: Joi.string().max(20).required(), //开始邮编
    max: Joi.string().max(20).required(), //结束邮编
    comment: Joi.string().max(255).allow(null) //备注
};

//渠道信息
const channel = {
    id: Joi.number().integer().required(), //渠道编号
    name: Joi.string().max(50).required(), //渠道英文名称
    name_cn: Joi.string().max(50).allow(null), //渠道中文名称
    pinyin: Joi.string().max(255).allow(null), //渠道拼音
    description: Joi.string().max(255).allow(null) //渠道描述
};

const channel_for_change = delete_property(Object.assign({}, channel), ['id', 'pinyin']);

//分区国家信息
const zone_country = {
    id: Joi.number().integer().required(), //关系编号
    zone_id: Joi.number().integer().required(), //所属分区编号
    country_id: Joi.number().integer().required(), //所属国家编号
    extend_type: Joi.string().replace('country', '1').replace('province', '2').replace('city', '3').replace('postcode', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).allow(null), //扩展类型，null和0,1默认国家，2说明包含的是一个省州，extend_message包含具体的省州信息，3说明包含的是一个城市，extend_message包含具体的城市信息，4说明包含的是一个邮编段，extend_message包含具体的邮编段信息
    extend_message: Joi.string().max(255).allow(null), //扩展信息
};

const zone_country_for_change = delete_property(Object.assign({}, zone_country), ['id', 'zone_id']);

//分区信息
const zone = {
    id: Joi.number().integer().required(), //分区编号
    //type: Joi.string().replace('service_type', '0').replace('line', '1').replace('sell_product', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null),//所属类型，0服务类型，1线路，2销售产品
    owner_id: Joi.number().integer().allow(null), //所有者编号
    name: Joi.string().max(50).required(), //分区名称
    description: Joi.string().max(255).allow(null), //分区描述
    country_lists: Joi.array().items(Joi.object(zone_country).unknown(true)).allow(null) //国家信息列表
};

const zone_without_countrys = delete_property(Object.assign({}, zone), ['country_lists']);

//分区和国家列表信息
const zone_country_cell = {
    name: Joi.string().max(50).required(), //分区名称
    description: Joi.string().max(255).allow(null), //分区描述
    country_id: Joi.number().integer().required(), //所属国家编号
    extend_type: Joi.string().replace('country', '1').replace('province', '2').replace('city', '3').replace('postcode', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).allow(null), //扩展类型，null和0,1默认国家，2说明包含的是一个省州，extend_message包含具体的省州信息，3说明包含的是一个城市，extend_message包含具体的城市信息，4说明包含的是一个邮编段，extend_message包含具体的邮编段信息
    extend_message: Joi.string().max(255).allow(null) //扩展信息
};

const zone_for_create = delete_property(Object.assign({}, zone, {
    country_lists: Joi.array().items(zone_country_for_change).allow(null), //国家信息列表
}), ['id', 'owner_id']);

const zone_for_change = delete_property(Object.assign({}, zone), ['id', 'owner_id']);

//服务类型信息
const service_type = {
    id: Joi.number().integer().required(), //服务类型编号
    name: Joi.string().max(50).required(), //名称
    channel_id: Joi.number().integer().required(), //渠道编号
    v_country_id: Joi.number().integer(), //国家编号
    place_ids: Joi.string().max(500).allow(null), //适用范围编号，必须存在，前端没有提供使用默认中国
    comment: Joi.string().max(10000).allow(null), //备注说明
    homepage: Joi.string().max(255).allow(null), //主页，必须正确，这样才能跟踪
    trace_type_id: Joi.number().integer().allow(null), //跟踪类型编号
    assign_type_id: Joi.number().integer().allow(null) //订单分配类型(对接的)
};

const service_type_with_time = add_time_info(service_type);

const service_type_for_change = delete_property(Object.assign({}, service_type), ['id']);

//货币信息
const currency = {
    id: Joi.number().integer().required(), //货币类型编号
    name: Joi.string().max(50).required(), //名称
    mark: Joi.string().max(50).allow(null), //简称
    name_cn: Joi.string().max(50).required(), //中文名
    pinyin: Joi.string().max(255).allow(null), //国家拼音
    name_local: Joi.string().max(50).allow(null) //本地名称
};

const currency_for_change = delete_property(Object.assign({}, currency), ['id', 'pinyin']);
const currency_for_allow = Joi.object(currency).optionalKeys('name', 'name_cn');
//公布价分段信息
const publish_price_stage = {
    id: Joi.number().integer().required(), //区段编号
    publish_price_id: Joi.number().integer().required(), //公布价编号
    region_type: Joi.string().replace('zone', '0').replace('country', '1').replace('province', '2').replace('city', '3').replace('county', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).default(0), //区域类型(默认分区0、国家1、省州2、城市3、区县4)
    region_id: Joi.number().integer().required(), //区域编号
    min_weight: Joi.number().required(), //起始重量
    max_weight: Joi.number().required(), //结束重量
    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0), //货品类型(默认包裹0、文件1、防水袋2)
    unit: Joi.number().required(), //计费单元
    comment: Joi.string().max(255).allow(null), //备注
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).default(0), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    ori_price: Joi.number() //原始价格数值
};

const publish_price_stage_for_create = delete_property(Object.assign({}, publish_price_stage), ['id', 'publish_price_id']);

const publish_price_stage_for_change = {
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    ori_price: Joi.number().required() //原始价格数值
};

//公布价
const publish_price = {
    id: Joi.number().integer().required(), //公布价编号
    name: Joi.string().max(50).allow(null), //名称
    currency_id: Joi.number().integer().required(), //货币代码
    service_type_id: Joi.number().integer().required(), //服务类型编号
    comment: Joi.string().max(10000).allow(null), //备注说明
    enabled_at: Joi.date().allow(null), //启用时间
    expired_at: Joi.date().allow(null), //失效时间,默认null永不失效
    price_stages: Joi.array().items(publish_price_stage).allow(null) //具体价格列表
};

const publish_price_without_stages = delete_property(Object.assign({}, publish_price), ['price_stages']);

const publish_price_for_create = delete_property(Object.assign({}, publish_price, {
    price_stages: Joi.array().items(publish_price_stage_for_create).allow(null) //具体价格列表
}), ['id', 'service_type_id']);

const publish_price_for_create_cell = delete_property(Object.assign({}, publish_price, publish_price_stage_for_create), ['id', 'price_stages', 'service_type_id']);

const publish_price_for_change = delete_property(Object.assign({}, publish_price), ['id', 'currency_id', 'service_type_id', 'price_stages']);

//公布价结果信息
const publish_price_result = {
    service_type_id: Joi.number().integer().required(), //快递类别编号
    name: Joi.string().max(50).required(), //快递类别名称
    place_ids: Joi.string().max(500).required(), //起运城市列表
    publish_price_id: Joi.number().integer().required(), //公布价格编号
    price: Joi.number().required(), //价格
    price_formula: Joi.string().max(255).required(), //计算公式(例子5*x+10，首重10元续重5元)
    comment: Joi.string().allow(null) //备注
};

//承运商信息
const carrier = {
    id: Joi.number().integer().required(), //承运商编号
    name: Joi.string().max(50).required(), //承运商名字
    contact: Joi.string().max(20).allow(null), //联系人
    phone: Joi.string().max(20).allow(null), //联系电话
    mobile: Joi.string().max(20).allow(null), //联系手机
    station_id: Joi.number().integer().required() //所属站点
};

const carrier_for_change = delete_property(Object.assign({}, carrier), ['id']);

const carrier_with_time = add_time_info(carrier);

//基本站点信息
const station_base = {
    id: Joi.number().integer().required(), //城市编号
    name: Joi.string().max(100).required(), //城市英文名称
    city_id: Joi.number().integer().required(), //所属城市编号
    country_id: Joi.number().integer().required(), //所属国家编号
    province_id: Joi.number().integer().allow(null), //所属省州编号
    county_id: Joi.number().integer().allow(null), //所属区县编号
    address: Joi.string().max(255).required(), //地址信息
    contact: Joi.string().max(20).allow(null), //联系人
    phone: Joi.string().max(20).allow(null), //电话
    mobile: Joi.string().max(20).allow(null) //手机
};

//自有站点信息
const station = Object.assign({
    type: Joi.number().integer().allow(null), //站点类型1独立公司       2分公 司3站点
    super_id: Joi.number().integer().allow(null) //上级站点编号
}, station_base);

const station_for_change = delete_property(Object.assign({}, station), ['id']);

//承运商站点信息
const carrier_station = Object.assign({
    carrier_id: Joi.number().integer() //所属承运商编号
}, station_base);

const carrier_station_with_name = Object.assign({
    carrier: { name: Joi.string().max(50).required() }
}, carrier_station);

const carrier_station_for_change = delete_property(Object.assign({}, carrier_station), ['id', 'carrier_id']);

//线路信息
const line = {
    id: Joi.number().integer().required(), //线路编号
    name: Joi.string().max(50).required(), //线路名称
    carrier_id: Joi.number().integer().required(), //所属承运商
    channel_id: Joi.number().integer().allow(null), //使用的渠道
    service_type_id: Joi.number().integer().allow(null), //使用的服务类型
    v_country_id: Joi.number().integer(), //国家编号
    place_ids: Joi.string().max(500).allow(null), //适用范围编号，必须存在，前端没有提供使用默认中国
    station_id: Joi.number().integer().required(), //站点编号
    comment: Joi.string().max(10000).allow(null) //备注
};

const line_with_time = add_time_info(line);

const line_for_change = delete_property(Object.assign({}, line), ['id', 'carrier_id']);

//成本价分段信息
const cost_price_stage = {
    id: Joi.number().integer().required(), //区段编号
    cost_price_id: Joi.number().integer().required(), //成本价编号
    region_type: Joi.string().replace('zone', '0').replace('country', '1').replace('province', '2').replace('city', '3').replace('county', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).default(0), //区域类型(默认分区0、国家1、省州2、城市3、区县4)
    region_id: Joi.number().integer().required(), //区域编号
    min_weight: Joi.number().required(), //起始重量
    max_weight: Joi.number().required(), //结束重量
    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0), //货品类型(默认包裹0、文件1、防水袋2)
    unit: Joi.number().allow(null), //计费单元
    price_formula: Joi.string().max(255).allow(null), //计算公式(例子5*weight+10，首重10元续重5元)
    comment: Joi.string().max(255).allow(null), //备注
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).default(0), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    ori_price: Joi.number() //原始价格数值
};

const cost_price_stage_for_create = delete_property(Object.assign({}, cost_price_stage), ['id', 'cost_price_id']);

const cost_price_stage_for_change = {
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    // unit: Joi.number(),//计费单元
    ori_price: Joi.number().required() //原始价格数值
};

//成本价
const cost_price = {
    id: Joi.number().integer().required(), //公布价编号
    name: Joi.string().max(50).allow(null), //名称
    currency_id: Joi.number().integer().required(), //货币代码
    line_id: Joi.number().integer().required(), //服务类型编号
    comment: Joi.string().max(10000).allow(null), //备注说明
    enabled_at: Joi.date().allow(null), //启用时间
    expired_at: Joi.date().allow(null), //失效时间,默认null永不失效
    price_stages: Joi.array().items(cost_price_stage).allow(null) //具体价格列表
};

const cost_price_without_stages = delete_property(Object.assign({}, cost_price), ['price_stages']);

const cost_price_for_create = delete_property(Object.assign({}, cost_price, {
    price_stages: Joi.array().items(cost_price_stage_for_create).allow(null) //具体价格列表
}), ['id', 'line_id']);

const cost_price_for_change = delete_property(Object.assign({}, cost_price), ['id', 'currency_id', 'line_id', 'price_stages']);

const cost_price_for_create_cell = delete_property(Object.assign({}, cost_price, cost_price_stage_for_create), ['id', 'price_stages', 'line_id']);

//成本价结果信息
const cost_price_result = {
    line_id: Joi.number().integer().required(), //成本编号
    name: Joi.string().max(50).required(), //线路名称
    place_ids: Joi.string().max(500).required(), //起运城市列表
    cost_price_id: Joi.number().integer().required(), //成本价格编号
    price: Joi.number().required(), //价格
    price_formula: Joi.string().max(255).required(), //计算公式(例子5*x+10，首重10元续重5元)
    comment: Joi.string().allow(null) //备注
};

//销售产品信息
const sell_product = {
    id: Joi.number().integer().required(), //线路编号
    name: Joi.string().max(50).required(), //线路名称
    channel_id: Joi.number().integer().allow(null), //使用的渠道
    service_type_id: Joi.number().integer().allow(null), //使用的服务类型
    line_id: Joi.number().integer().allow(null), //继承的线路编号
    v_country_id: Joi.number().integer(), //国家编号
    place_ids: Joi.string().max(500).allow(null), //适用范围编号，必须存在，前端没有提供使用默认中国
    station_id: Joi.number().integer().allow(null), //所属站点编号
    inherit: Joi.number().integer().allow(null), //是否继承于快递类型或者线路
    auto_update: Joi.number().integer().allow(null), //是否自动更新
    auto_create: Joi.number().integer().allow(null), //是否自动创建
    template_id: Joi.number().integer().allow(null), //模版编号
    comment: Joi.string().max(10000).allow(null) //备注
};
const sell_product_change = {
    id: Joi.number().integer().required(), //线路编号
    name: Joi.string().max(50).allow(null), //线路名称
    channel_id: Joi.number().integer().allow(null), //使用的渠道
    service_type_id: Joi.number().integer().allow(null), //使用的服务类型
    line_id: Joi.number().integer().allow(null), //继承的线路编号
    place_ids: Joi.string().max(500).allow(null), //适用范围编号，必须存在，前端没有提供使用默认中国
    station_id: Joi.number().integer().allow(null), //所属站点编号
    inherit: Joi.number().integer().allow(null), //是否继承于快递类型或者线路
    auto_update: Joi.number().integer().allow(null), //是否自动更新
    auto_create: Joi.number().integer().allow(null), //是否自动创建
    template_id: Joi.number().integer().allow(null), //模版编号
    comment: Joi.string().max(10000).allow(null) //备注
};

const sell_product_with_time = add_time_info(sell_product);
const sell_product_for_create = delete_property(Object.assign({}, sell_product), ['id']);
const sell_product_for_change = delete_property(Object.assign({}, sell_product_change), ['id']);

//销售价分段信息
const sell_price_stage = {
    id: Joi.number().integer().required(), //区段编号
    sell_price_id: Joi.number().integer().required(), //销售价编号
    user_level: Joi.number().integer().allow(null), //针对的用户等级
    user_id: Joi.number().integer().allow(null), //特化的用户编号
    region_type: Joi.string().replace('zone', '0').replace('country', '1').replace('province', '2').replace('city', '3').replace('county', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).default(0), //区域类型(默认分区0、国家1、省州2、城市3、区县4)
    region_id: Joi.number().integer().required(), //区域编号
    min_weight: Joi.number().required(), //起始重量
    max_weight: Joi.number().required(), //结束重量
    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
    unit: Joi.number().required(), //计费单元
    price_formula: Joi.string().max(255).allow(null), //计算公式(例子5*weight+10，首重10元续重5元)
    comment: Joi.string().max(255).allow(null), //备注
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).default(0), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    ori_price: Joi.number() //原始价格数值
};

const sell_price_stage_for_create = delete_property(Object.assign({}, sell_price_stage), ['id', 'sell_price_id']);

const sell_price_stage_for_change = {
    ori_type: Joi.string().replace('direct', '0').replace('single', '1').replace('stage', '2').replace('step', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]), //原始计算方式，0直接价格，1单份价格，2区间价格，3区段重量
    ori_price: Joi.number().required() //原始价格数值
};

//销售价信息
const sell_price = {
    id: Joi.number().integer().required(), //公布价编号
    name: Joi.string().max(50).required(), //销售价名称
    currency_id: Joi.number().integer().required(), //货币代码
    sell_product_id: Joi.number().integer().allow(null), //对应的销售产品编号
    comment: Joi.string().max(10000).allow(null), //备注
    enabled_at: Joi.date().allow(null), //启用时间
    expired_at: Joi.date().allow(null), //失效时间,默认null永不失效
    price_stages: Joi.array().items(sell_price_stage).allow(null) //具体价格列表
};

const sell_price_without_stages = delete_property(Object.assign({}, sell_price), ['price_stages']);

const sell_price_for_create = delete_property(Object.assign({}, sell_price, {
    price_stages: Joi.array().items(sell_price_stage_for_create).allow(null) //具体价格列表
}), ['id', 'sell_product_id']);

const sell_price_for_create_cell = delete_property(Object.assign({}, sell_price, sell_price_stage_for_create), ['id', 'price_stages', 'sell_product_id']);

const sell_price_for_change = delete_property(Object.assign({}, sell_price), ['id', 'currency_id', 'sell_product_id', 'price_stages']);

//销售价结果信息
const sell_price_result = {
    sell_product_id: Joi.number().integer().required(), //销售产品编号
    name: Joi.string().max(50).required(), //销售产品名称
    place_ids: Joi.string().max(500).required(), //起运城市列表
    sell_price_id: Joi.number().integer().required(), //销售价格编号
    price: Joi.number().required(), //价格
    price_formula: Joi.string().max(255).required(), //计算公式(例子5*x+10，首重10元续重5元)
    comment: Joi.string().allow(null) //备注
};

//详细地址信息
const place_info = {
    name: Joi.string().max(50).required(), //姓名
    country: Joi.string().max(50).allow(null), //国家名字
    country_mark: Joi.string().max(50).allow(null), //国家二字码
    country_id: Joi.number().integer().allow(null), //国家编号
    province: Joi.string().max(100).allow(null), //省州名字
    province_id: Joi.number().integer().allow(null), //省州编号
    city: Joi.string().max(100).allow(null), //城市名称
    city_id: Joi.number().integer().allow(null), //城市编号
    county: Joi.string().max(255).allow(null), //区县街道名字,可以为多级["余杭","仓前"]
    county_id: Joi.number().integer().allow(null), //区县街道编号
    address: Joi.string().max(255).required(), //详细地址
    company: Joi.string().max(100).allow(null), //公司名称
    department: Joi.string().max(100).allow(null), //部门名称
    phone: Joi.string().max(20).allow(null), //电话
    mobile: Joi.string().max(20).allow(null), //手机
    postcode: Joi.string().max(20).allow(null) //邮编
};
const place_info_for_change = Joi.object(place_info).optionalKeys('name', 'address');

//发送地址信息
const send_place_info = Joi.object(place_info).keys({
    identity: Joi.string().max(20).allow(null) //身份信息
});
const send_place_info_for_change = send_place_info.optionalKeys('name', 'address');

//上门提货信息
const fetch_info = Joi.object(place_info).keys({
    expect_time: Joi.date().allow(null) //期望上门时间
}).optionalKeys('name');
const fetch_info_for_change = fetch_info.optionalKeys('address');

//快递信息
const express_info = {
    name: Joi.string().max(50).allow(null), //快递公司名称
    id: Joi.number().integer().allow(null), //快递公司编号
    no: Joi.string().max(50).allow(null) //快递件编号
};
const express_info_for_create = Joi.object(express_info).requiredKeys('name', 'no');
// const express_info_attributes = [{ express_id: 'id', express_name: 'name', express_no: 'no' }];

//线路信息
const line_info = {
    channel_id: Joi.number().integer().allow(null), //渠道编号
    service_type_id: Joi.number().integer().allow(null), //服务类别编号
    sell_product_id: Joi.number().integer().allow(null) //销售产品编号
};

//存仓信息
const store_info = {
    city_id: Joi.number().integer().allow(null), //存仓城市编号
    station_id: Joi.number().integer().allow(null) //存仓站点
};
const store_info_for_create = Joi.object(store_info).requiredKeys('city_id');
// const store_info_attributes = [{ store_city_id: 'city_id', store_station_id: 'station_id' }];

//报关信息
const entry = {
    sku: Joi.string().max(50).allow(null), //货品sku
    name_en: Joi.string().max(100).required(), //英文品名
    name_cn: Joi.string().max(100).allow(null), //中文品名
    category_en: Joi.string().max(100).allow(null), //类目英文名
    category_cn: Joi.string().max(100).allow(null), //类目中文名
    origin: Joi.string().max(100).allow(null), //产地
    material: Joi.string().max(100).allow(null), //材质
    specification: Joi.string().max(100).allow(null), //规格
    usage: Joi.string().max(100).allow(null), //用途
    weight: Joi.number().allow(null), //货品重量
    count: Joi.number().integer().default(1).required(), //货品数量
    unit: Joi.string().replace('pce', '0').replace('set', '1').replace('mtr', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null), //货品单位
    per_price: Joi.number().required(), //货品单价
    price: Joi.number().allow(null), //货品总价
    ccrn: Joi.string().max(50).allow(null), //货品海关编号
    comment: Joi.string().max(255).allow(null) //备注信息
};

//报关信息
const entry_for_allow = Joi.object(entry).optionalKeys('name_en', 'count','per_price');

//物品扩展信息
const goods_extend_info = {
    insure: Joi.number().allow(null), //货品报价
    insurance: Joi.number().allow(null), //货品保险
    price: Joi.number().allow(null), //货品价值
    has_battery: Joi.boolean().truthy(['Y', 'yes', '1', 1]).falsy(['N', 'no', '0', 0]).allow(null), //是否有电池
    kind: Joi.string().replace('gift', '1').replace('sample', '2').replace('document', '3').replace('other', '4').valid(['1', '2', '3', '4', 1, 2, 3, 4]).allow(null), //货品细分类型(礼品1、商品货样2、文件3、其他4)
    undelivery_option: Joi.string().replace('discard', '1').replace('back', '2').valid(['1', '2', 1, 2]).allow(null), //当邮件不能被投递时的策略(1丢弃，2送回)
    duty_paid: Joi.boolean().truthy(['Y', 'yes', '1', 1]).falsy(['N', 'no', '0', 0]).allow(null), //是否收件人支付关税，为Y时表示收件人支付
};

//包裹尺寸重量信息
const goods = {
    tag_no: Joi.string().max(50).allow(null), //客户给的子标记编号
    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null).default(0), //货品类型(默认包裹0、文件1、防水袋2)
    weight: Joi.number().allow(null), //货品重量
    long: Joi.number().allow(null), //货品长
    wide: Joi.number().allow(null), //货品宽
    high: Joi.number().allow(null), //货品高
    count: Joi.number().integer().allow(null), //货品数量
    // child_lists: Joi.array().items(Joi.lazy(() => Joi.object(goods))).allow(null), //子货物信息
    entrys: Joi.array().items(entry_for_allow).allow(null), //报关信息列表
    extend_info: Joi.object(goods_extend_info).allow(null), //扩展信息
    comment: Joi.string().max(50).allow(null) //备注
};

const goods_for_get = Joi.object(goods).keys({
    id: Joi.number().integer().required(), //预约编号
    // child_lists: Joi.array().items(Joi.lazy(() => goods_for_get)).allow(null), //子货物信息
});
// const goods_attributes = removeAttributes(enumerateKeys(goods_for_get), ['child_lists']);
// const order_goods_attributes = [{ tag_no: 'tag_no', user_id: 'user_id', user_type: 'user_type', type: 'goods_type', weight: 'goods_weight', long: 'goods_long', wide: 'goods_wide', high: 'goods_high', count: 'goods_count', entrys: 'goods_entrys', extend_info: 'goods_extend_info', child_lists: 'goods_lists' }];
// const order_get_goods_attributes = [{ tag_no: 'tag_no', type: 'goods_type', weight: 'goods_weight', long: 'goods_long', wide: 'goods_wide', high: 'goods_high', count: 'goods_count', entrys: 'goods_entrys', extend_info: 'goods_extend_info', child_lists: 'goods_lists' }];

//预报信息(通用创建)
const order = {
    //id: Joi.number().integer(), //预约编号
    //user_type: Joi.string().replace('registered', '0').replace('temp', '1').valid(['0', '1', 0, 1]), //用户类型
    //user_id: Joi.number().integer(), //用户编号
    //station_id: Joi.number().integer().required(), //所属站点编号
    tag_no: Joi.string().max(50).allow(null), //客户给的标记编号
    //operator_id: Joi.number().integer(), //操作者编号
    order_type: Joi.string().replace('web', '0').replace('app', '1').replace('admin', '2').valid(['0', '1', '2', 0, 1, 2]), //预约方式，0网站预约，1客户端预约，2电话预约

    fetch_type: Joi.string().replace('fetch', '0').replace('express', '1').replace('give', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null), //取件方式，0上门取件，1快递投递，2自己投递
    fetch_info: fetch_info.when('fetch_type', { is: 0, then: Joi.required() }), //上门取件信息
    express_info: express_info_for_create.when('fetch_type', { is: 1, then: Joi.required() }), //快递投递信息

    operate_type: Joi.string().replace('transport', '0').replace('store', '1').valid(['0', '1', 0, 1]).allow(null), //业务类型，0递送，1存仓

    sender_info: send_place_info_for_change, //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    send_address_id: Joi.number().integer().allow(null), //发送地址编号，没有默认需要提供
    //v_sender_country_id: Joi.number().integer().allow(null), //起始国家编号，后端根据城市编号生成
    sender_place_id: Joi.number().integer().allow(null), //发送地址编号
    line_info: Joi.object(line_info), //.when('operate_type', { is: 0, then: Joi.required() }), //线路信息
    transport_type: Joi.string().replace('air', '0').replace('road', '1').replace('ship', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null), //运输方式，0空运，1陆运，2海运
    receiver_info: place_info_for_change, //.when('operate_type', {is: 0, then: Joi.required()}),//接收者信息,递送的方式没有默认发送信息需要提供
    receive_address_id: Joi.number().integer().allow(null), //接收地址编号，没有默认需要提供
    //v_receiver_country_id: Joi.number().integer(), //接收国家编号，后端根据城市编号生成
    receiver_place_id: Joi.number().integer().allow(null), //接收地址编号
    //v_receiver_postcode: Joi.string().max(20), //接收邮编号码

    store_info: store_info_for_create.when('operate_type', { is: 1, then: Joi.required() }), //存仓信息

    goods_type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).allow(null), //货品类型(默认包裹0、文件1、防水袋2)
    goods_weight: Joi.number().allow(null), //货品重量
    goods_long: Joi.number().allow(null), //货品长
    goods_extend_info: Joi.object(goods_extend_info).allow(null), //扩展信息
    goods_wide: Joi.number().allow(null), //货品宽
    goods_high: Joi.number().allow(null), //货品高
    goods_count: Joi.number().integer().allow(null), //货品数量
    goods_lists: Joi.array().items(goods).allow(null), //包裹详情列表
    goods_entrys: Joi.array().items(entry_for_allow).allow(null), //报关信息列表
    goods_extend_info: Joi.object(goods_extend_info).allow(null), //扩展信息
    comment: Joi.string().max(255).allow(null), //货物备注信息
    //status: Joi.string().replace('ordered', '0').replace('fetched', '1').replace('depart', '2').replace('stored', '3').replace('deleted', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]), //状态，0已预报，1已取件，2已录单，3已存仓，4已删除

    //created_at: Joi.date(), //创建时间
    //updated_at: Joi.date() //更新时间
};

//修改
const order_for_change = Joi.object(order).keys({
    fetch_info: fetch_info.allow(null), //上门取件信息
    express_info: Joi.object(express_info).allow(null), //快递投递信息
    sender_info: send_place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    receiver_info: place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    store_info: Joi.object(store_info).allow(null) //.when('operate_type', { is: 1, then: Joi.required() }), //存仓信息
});

//前端获取
const order_for_get = Joi.object(order).keys({
    id: Joi.number().integer(), //预约编号
    station_id: Joi.number().integer().allow(null), //所属站点编号
    fetch_info: fetch_info.allow(null), //上门取件信息 express_info: Joi.object(express_info).allow(null), //快递投递信息
    sender_info: send_place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    receiver_info: place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    store_info: Joi.object(store_info).allow(null), //存仓信息
    goods_lists: Joi.array().items(goods_for_get).allow(null), //包裹详情列表
    v_sender_country_id: Joi.number().integer().allow(null), //起始国家编号，后端根据城市编号生成
    v_receiver_country_id: Joi.number().integer().allow(null), //接收国家编号，后端根据城市编号生成
    v_receiver_postcode: Joi.string().max(20).allow(null), //接收邮编号码
    status: Joi.string().replace('ordered', '0').replace('fetched', '1').replace('depart', '2').replace('stored', '3').replace('deleted', '4').valid(['0', '1', '2', '3', '4', 0, 1, 2, 3, 4]).allow(null), //状态，0已预报，1已取件，2已发货，3已存仓，4已删除
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
});
// const order_attributes = removeAttributes(enumerateKeys(order_for_get).concat(enumerateKeys(line_info)).concat(['express_name', 'express_id', 'express_no', 'store_city_id', 'store_station_id']), ['line_info', 'express_info', 'store_info', 'goods_type', 'goods_weight', 'goods_long', 'goods_wide', 'goods_high', 'goods_count', 'goods_lists', 'goods_entrys', 'goods_extend_info']);

//后端获取查询
const order_for_ready = removeKeys(order_for_get.keys({
    goods_id: Joi.number().allow(null),
    user_type: Joi.string().replace('offical', '0').replace('temp', '1').valid(['0', '1', 0, 1]).required(), //用户类型，0正式，1临时
    user_id: Joi.number().integer().required(), //客户编号
    operator_id: Joi.number().integer().allow(null), //操作者编号
}), ['fetch_info', 'store_info']);
// const order_for_ready_attributes = removeAttributes(enumerateKeys(order_for_ready).concat(['express_name', 'express_id', 'express_no']).concat(enumerateKeys(line_info)), ['line_info', 'express_info', 'store_info', 'goods_type', 'goods_weight', 'goods_long', 'goods_wide', 'goods_high', 'goods_count', 'goods_lists', 'goods_entrys', 'goods_extend_info']);

const order_create_result = reachKeys(order_for_get, ['id', 'status', 'tag_no']);

//运输主体(通用创建)
const transport = {
    //id: Joi.number().integer().required(), //运输编号
    order_id: Joi.number().integer().allow(null), //预报编号
    user_type: Joi.string().replace('offical', '0').replace('temp', '1').valid(['0', '1', 0, 1]).default('0').allow(null), //用户类型，0正式，1临时
    user_id: Joi.number().integer().allow(null), //客户编号
    fetcher_id: Joi.number().integer().allow(null), //提货员编号
    agent_id: Joi.number().integer().allow(null), //经办人编号
    //station_id: Joi.number().integer().required(), //所属站点编号
    tag_no: Joi.string().max(50).allow(null), //客户给的标记编号
    //super_id: Joi.number().integer().allow(null), //上级订单编号
    //sub_ids: Joi.string().max(5000).allow(null), 下级订单列表
    sender_info: send_place_info_for_change, //发送者信息,递送的方式没有默认发送信息需要提供
    send_address_id: Joi.number().integer().allow(null), //发送地址编号，没有默认需要提供
    //v_sender_country_id: Joi.number().integer().allow(null), //起始国家编号，后端根据城市编号生成
    sender_place_id: Joi.number().integer().allow(null), //发送地址编号
    channel_id: Joi.number().integer().allow(null), //用户指定的渠道编号
    service_type_id: Joi.number().integer().allow(null), //用户指定的服务类别
    sell_product_id: Joi.number().integer().allow(null), //用户指定的销售产品编号
    //used_product_id: Joi.number().integer().allow(null), //最终使用的销售产品编号
    //sell_price_id: Joi.number().integer().allow(null), //最终使用的销售价编号
    //sell_country_price_id: Joi.number().integer.allow(null), //最终使用的销售价区段
    transport_type: Joi.string().replace('air', '0').replace('road', '1').replace('ship', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null), //运输方式，0空运，1陆运，2海运
    receiver_info: place_info_for_change, //接收者信息,递送的方式没有默认发送信息需要提供
    receive_address_id: Joi.number().integer().allow(null), //接收地址编号，没有默认需要提供
    //v_receiver_country_id: Joi.number().integer(), //接收国家编号，后端根据城市编号生成
    receiver_place_id: Joi.number().integer().allow(null), //接收地址编号
    receiver_postcode: Joi.string().max(20).allow(null), //接收邮编号码
    carrier_id: Joi.number().allow(null), //承运商编号
    real_channel_id: Joi.number().allow(null), //最终选择的渠道编号
    real_service_type_id: Joi.number().allow(null), //最终选择的快递类别编号
    real_line_id: Joi.number().allow(null), //最终选择的运输线路编号
    //cost_price_id: Joi.number().integer().allow(null), //最终使用的成本价编号
    //cost_country_price_id: Joi.number().integer.allow(null), //最终使用的成本价区段
    line_no: Joi.string().max(50).allow(null), //真实的运单号
    exchange_no: Joi.string().max(50).allow(null), //参考号，换单号
    goods_id: Joi.number().integer().allow(null), //物品信息编号
    goods_type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).allow(null), //货品类型(默认包裹0、文件1、防水袋2)
    goods_long: Joi.number().allow(null), //货品长
    goods_wide: Joi.number().allow(null), //货品宽
    goods_high: Joi.number().allow(null), //货品高
    goods_count: Joi.number().integer().allow(null), //货品数量
    goods_entrys: Joi.array().items(entry_for_allow).allow(null), //报关信息列表
    goods_extend_info: Joi.object(goods_extend_info).allow(null), //扩展信息
    order_weight: Joi.number().allow(null), //预报重量
    in_weight: Joi.number().allow(null), //收货重量
    in_bulky_weight: Joi.number().allow(null), //收货泡重
    //v_in_weight: Joi.number().allow(null), //收货计费重量
    out_weight: Joi.number().allow(null), //出货重量
    out_bulky_weight: Joi.number().allow(null), //出货泡重
    //v_out_weight: Joi.number().allow(null), //出货计费重量
    carrier_weight: Joi.number().allow(null), //下家给的计费重
    //receivable: Joi.number().allow(null), //应收费用
    //paid_receivable: Joi.number().allow(null), //已收应收费用
    //payable: Joi.number().allow(null), //应付费用
    //paid_payable: Joi.number().allow(null), //已付应付费用
    in_pay_type: Joi.string().replace('account', '0').replace('bill', '1').replace('cash', '2').replace('back', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).allow(null), //收费方式
    out_pay_type: Joi.string().replace('account', '0').replace('bill', '1').replace('cash', '2').replace('back', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).allow(null), //收费方式
    comment: Joi.string().max(255).allow(null), //货物备注信息
    //problem_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]); //是否有问题
    //v_receive_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]); //是否未付款
    //v_pay_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]); //是否未付款
    status: Joi.string().replace('record', '2').replace('dispatched', '3').replace('leave', '4').replace('transport', '5').replace('arrived', '6').replace('end', '7').valid(['2', '3', '4', '5', '6', '7', 2, 3, 4, 5, 6, 7]), //状态，2已录单，3已分配，4已出货，5转运中，6已送达，7已结束
    //last_trace_at: Joi.date().required(), //最后一次跟踪时间
    start_at: Joi.date().allow(null), //业务开始时间
    fetch_at: Joi.date().allow(null), //取件时间
    //collected_at: Joi.date().required(), //收款时间
    //paid_at: Joi.date().required(), //付款时间
    //arrived_at: Joi.date().required(), //到达时间
    //created_at: Joi.date().required(), //创建时间
    //updated_at: Joi.date().required() //更新时间
};

//快速创建，只创建部分内容
const transport_for_quick = reachKeys(transport, ['tag_no', 'user_type', 'user_id', 'in_weight', 'channel_id', 'service_type_id', 'real_line_id', 'carrier_id', 'line_no', 'in_pay_type', 'out_pay_type', 'status']);

//修改
const transport_for_change = removeKeys(Joi.object(transport), ['order_id', 'user_type', 'user_id', 'goods_id']).keys({
    sender_info: send_place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    receiver_info: place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
});

const transport_for_change_more = transport_for_change.keys({
    id: Joi.number().integer(), //运输编号
});

//获取
const transport_for_get = Joi.object(transport).keys({
    id: Joi.number().integer().required(), //运输编号
    sender_info: send_place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    receiver_info: place_info_for_change.allow(null), //.when('operate_type', {is: 0, then: Joi.required()}),//发送者信息,递送的方式没有默认发送信息需要提供
    company_id: Joi.number().integer().allow(null), //所属公司编号
    station_id: Joi.number().integer().allow(null), //所属站点编号
    super_id: Joi.number().integer().allow(null), //上级订单编号
    sub_ids: Joi.string().max(5000).allow(null), //下级订单列表
    v_sender_country_id: Joi.number().integer().allow(null), //起始国家编号，后端根据城市编号生成
    used_product_id: Joi.number().integer().allow(null), //最终使用的销售产品编号
    sell_price_id: Joi.number().integer().allow(null), //最终使用的销售价编号
    sell_country_price_id: Joi.number().integer().allow(null), //最终使用的销售价区段
    v_receiver_country_id: Joi.number().integer().allow(null), //接收国家编号，后端根据城市编号生成
    cost_price_id: Joi.number().integer().allow(null), //最终使用的成本价编号
    cost_country_price_id: Joi.number().integer().allow(null), //最终使用的成本价区段
    v_in_weight: Joi.number().allow(null), //收货计费重量
    v_out_weight: Joi.number().allow(null), //出货计费重量
    receivable: Joi.number().allow(null), //应收费用
    paid_receivable: Joi.number().allow(null), //已收应收费用
    payable: Joi.number().allow(null), //应付费用
    paid_payable: Joi.number().allow(null), //已付应付费用
    problem_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]).allow(null), //是否有问题
    v_receive_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]).allow(null), //是否未付款
    v_pay_status: Joi.string().replace('no', '0').replace('has', '1').valid(['0', '1', 0, 1]).allow(null), //是否未付款
    last_trace_at: Joi.date().allow(null), //最后一次跟踪时间
    start_at: Joi.date(), //业务开始时间
    fetch_at: Joi.date().allow(null), //取件时间
    collected_at: Joi.date().allow(null), //收款时间
    paid_at: Joi.date().allow(null), //付款时间
    arrived_at: Joi.date().allow(null), //到达时间
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
});

const transport_batch_result = reachKeys(transport_for_get, ['id', 'receivable', 'paid_receivable', 'payable', 'paid_payable', 'status']);
const transport_quick_result = reachKeys(transport_for_get, ['id', 'receivable', 'paid_receivable', 'payable', 'paid_payable', 'status']);

//发货对象，上传条件
const transport_for_start = reachKeys(transport_for_change, ['out_weight', 'carrier_id', 'real_channel_id', 'real_service_type_id', 'real_line_id', 'tag_no', 'line_no', 'status']);

const transport_start_result = reachKeys(transport_for_get, ['id', 'receivable', 'paid_receivable', 'payable', 'paid_payable', 'status']);

//员工信息
const staff = {
    id: Joi.number().integer(), //员工编号
    name: Joi.string().min(1).max(50), //员工名称
    email: Joi.string().max(255).email().allow(null), //全局唯一邮箱,可以用于登录
    station_id: Joi.number().allow(null), //员工所在站点
    company_id: Joi.number().allow(null), //员工所在公司
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
};

const staff_for_change = delete_property(Object.assign({}, staff), ['id', 'created_at', 'updated_at']);

//员工个人详细信息
const staff_info = {
    staff_id: Joi.number().integer(), //员工编号
    real_name: Joi.string().max(255).required(), //员工真实姓名
    phone: Joi.string().max(20).required(), //员工手机号
    qq: Joi.string().max(20).required(), //员工QQ号
    gender: Joi.string().replace('female', '1').replace('male', '0').valid(['0', '1', 0, 1]).allow(null), //性别
    birthday: Joi.date().allow(null), //出生日期
    company: Joi.string().max(100).allow(null), //公司名称
    department: Joi.string().max(100).allow(null), //部门名称
    title: Joi.string().max(255).allow(null), //头衔
    office_addr: Joi.string().max(255).allow(null), //办公地址
    office_phone: Joi.string().max(20).allow(null), //办公电话
    office_fax: Joi.string().max(20).allow(null), //办公传真
    office_post: Joi.string().max(20).allow(null), //办公邮编
    home_addr: Joi.string().max(255).allow(null), //家庭地址
    home_phone: Joi.string().max(20).allow(null), //家庭电话
    home_post: Joi.string().max(20).allow(null), //家庭邮编
    homepage: Joi.string().max(255).allow(null), //主页
    memo: Joi.string().max(255).allow(null) //座右铭
};

//员工个人详细信息加时间
const staff_info_for_create = delete_property(Object.assign({}, staff_info), ['staff_id']);
const staff_info_with_time = add_time_info(staff_info);
const staff_info_for_get = Object.assign({}, staff_info, {
    created_at: Joi.date().allow(null), //创建时间
	updated_at: Joi.date().allow(null) //更新时间
});

const staff_info_for_change = Object.assign({}, staff_info_for_create, {
    real_name: Joi.string().max(255), //员工真实姓名
    phone: Joi.string().max(20), //员工电话
    qq: Joi.string().max(20) //员工QQ号
});

//部门类型
const department_type = {
    id: Joi.number().integer(), //编号
    name: Joi.string().min(2).max(50), //类型名称
    description: Joi.string().max(255).email().allow(null) //部门描述
};

const department_type_for_change = delete_property(Object.assign({}, department_type), ['id']);

//部门信息
const department = {
    id: Joi.number().integer(), //部门编号
    name: Joi.string().min(1).max(50), //部门名称
    type_id: Joi.number().integer(), //部门类型
    super_id: Joi.number().integer().allow(null), //上级部门编号
    station_id: Joi.number().integer().allow(null), //部门所在站点
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
};

const department_for_change = delete_property(Object.assign({}, department), ['id', 'created_at', 'updated_at']);

//部门日志表信息
const department_logs = {
    id: Joi.number().integer(), //部门编号
    name: Joi.string().min(2).max(50).required(), //部门名称
    type_id: Joi.number().integer().required(), //部门类型
    super_id: Joi.number().integer().allow(null), //上级部门编号
    old_name: Joi.number().integer().allow(null), //老的部门名称
    old_type_id: Joi.number().integer().allow(null), //老的部门类型
    super_id: Joi.number().integer().allow(null), //老的上级部门编号
    station_id: Joi.number().integer().allow(null), //部门所在站点
    operator_id: Joi.number().integer().allow(null), //操作者编号
    created_at: Joi.date(), //创建时间
    updated_at: Joi.date() //更新时间
};

const department_logs_for_change = delete_property(Object.assign({}, department), ['id', 'created_at', 'updated_at']);

//操作权限信息
const action = {
    id: Joi.number().integer(), //权限编号
    name: Joi.string().min(1).max(50), //权限名称
    name_cn: Joi.string().max(50).allow(null), //中文名称
    pinyin: Joi.string().max(255).allow(null), //权限拼音
    api_url: Joi.string().max(255), //对应的操作链接
    super_id: Joi.number().integer(), //上级操作编号
    region_type: Joi.number().integer(), //针对的范围类型，0公司范围，>1部门类型
    match_type: Joi.string().replace('perfect', '0').replace('cover', '1').valid(['0', '1', 0, 1]).allow(null), //匹配类型
    comment: Joi.string().max(255).allow(null), //备注
    operator_id: Joi.number().integer().allow(null) //操作者编号
};

const action_for_create = delete_property(Object.assign({}, action), ['id']);

//角色信息
const actor = {
    id: Joi.number().integer(), //角色编号
    name: Joi.string().min(2).max(50), //角色名称
    region_type: Joi.number().integer(), //针对的范围类型，0公司范围，>1部门类型
    comment: Joi.string().max(255).allow(null) //备注
};

const actor_for_create = delete_property(Object.assign({}, actor), ['id']);

//角色包含的操作
const actor_action = {
    id: Joi.number().integer(), //编号
    actor_id: Joi.number().integer(), //角色编号
    action_id: Joi.number().integer() //操作编号
};

const actor_action_for_create = delete_property(Object.assign({}, actor_action), ['id']);
const actor_action_for_add = delete_property(Object.assign({}, actor_action), ['actor_id', 'id']);
//角色包含的操作日志表
const actor_action_logs = {
    id: Joi.number().integer(), //编号
    actor_id: Joi.number().integer().required(), //角色编号
    action_ids: Joi.string().max(2000) //新的操作编号
};
const actor_action_logs_for_create = delete_property(Object.assign({}, actor_action_logs), ['id']);
const actor_action_logs_for_add = delete_property(Object.assign({}, actor_action_logs), ['actor_id', 'id']);

//头衔信息
const title = {
    id: Joi.number().integer(), //头衔编号
    name: Joi.string().min(3).max(50), //头衔名称
    comment: Joi.string().max(255).allow(null) //备注
};

const title_for_create = delete_property(Object.assign({}, title), ['id']);

//头衔包含的角色
const title_actor = {
    id: Joi.number().integer(), //编号
    title_id: Joi.number().integer(), //头衔编号
    actor_id: Joi.number().integer() //角色编号
};

const title_actor_for_create = delete_property(Object.assign({}, title_actor), ['id']);

//员工所在的部门
const staff_department = {
    id: Joi.number().integer(), //编号
    staff_id: Joi.number().integer().required(), //员工编号
    department_type_id: Joi.number().integer().required(), //部门类型
    department_id: Joi.number().integer().required(), //部门编号
    created_at: Joi.date(), //创建时间
};

const staff_department_for_create = delete_property(Object.assign({}, staff_department), ['id', 'created_at']);

const staff_department_for_add = delete_property(Object.assign({}, staff_department), ['id', 'created_at', 'staff_id']);
//员工拥有的角色及有效范围
const staff_actor = {
    id: Joi.number().integer(), //编号
    staff_id: Joi.number().integer(), //员工编号
    actor_id: Joi.number().integer(), //角色编号
    // title_id: Joi.number().integer().allow(null),//头衔编号,通过头衔进行分配就会有头衔编号
    region_type: Joi.number().integer(), //针对的范围类型，0公司范围，>1部门类型
    region_id: Joi.number().integer(), //对应的范围，站点编号或者部门编号
    created_at: Joi.date(), //创建时间
};

const staff_actor_for_create = delete_property(Object.assign({}, staff_actor), ['id', 'created_at']);

//员工拥有的操作权限及有效范围
const staff_action = {
    id: Joi.number().integer(), //编号
    staff_id: Joi.number().integer(), //员工编号
    action_id: Joi.number().integer(), //操作编号
    actor_id: Joi.number().integer().allow(null), //角色编号,透过角色进行分配会有角色编号
    title_id: Joi.number().integer().allow(null), //头衔编号,通过头衔进行分配就会有头衔编号
    region_type: Joi.number().integer(), //针对的范围类型，0公司范围，>1部门类型
    region_id: Joi.number().integer(), //对应的范围，站点编号或者部门编号
    extend_info: Joi.string().max(255), //权限扩展
    created_at: Joi.date(), //创建时间
};

const staff_action_for_create = delete_property(Object.assign({}, staff_action), ['id', 'created_at']);

const system_config = {
    id: Joi.number().integer().required(), //编号
    related_id: Joi.number().integer().allow(null), //关联编号
    extend_id: Joi.number().integer().allow(null), //扩展编号
    key: Joi.string().max(50).required(), //名称
    value: Joi.string().max(2000).required() //内容
};

const system_config_for_create = delete_property(Object.assign({}, system_config), ['id']);

const template = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required(), //模板名称
    type_id: Joi.number().integer().required(), //类型编号
    file_name: Joi.string().allow(null), //文件名字
    created_at: Joi.date() //创建时间
};
const template_for_create = delete_property(Object.assign({}, template), ['id']);

const transport_problem = {
    id: Joi.number().integer().required(), //编号
    transport_id: Joi.number().integer().required(), //运单编号
    problem_id: Joi.number().integer().required(), //问题编号
    comment: Joi.string().max(255).allow(null), //备注
    status: Joi.number().integer().required(), //问题处理状态
    detail: Joi.string().replace('unread', '0').replace('read', '1').replace('reply', '2').replace('deal', '3').valid(['0', '1', '2', '3', 0, 1, 2, 3]).default(0).required(), //问题处理细节状态
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required(), //更新时间
};

const transport_problem_for_create = delete_property(Object.assign({}, transport_problem), ['id', 'created_at', 'updated_at']);
const transport_problem_for_change = delete_property(Object.assign({}, transport_problem), ['id', 'transport_id', 'problem_id', 'created_at', 'updated_at']);

const problem = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required(), //问题名称
    operate_type: Joi.number().integer().required(), //处理类型
    content: Joi.string().max(255).required(), //问题内容
};
const problem_for_create = delete_property(Object.assign({}, problem), ['id', 'operate_type']);
const problem_for_change = {
    name: Joi.string().max(50).allow(null), //问题名称
    //operate_type: Joi.number().integer().allow(null), //处理类型
    content: Joi.string().max(255).allow(null), //问题内容
};
//收款账单表【collection_bills】
const collection_bill = {
    id: Joi.number().integer().required(), //编号
    type: Joi.number().integer().default(0), ////类型 [0运单账单，1手工账单，2仓储账单]
    user_id: Joi.number().integer().required(), //用户编号
    station_id: Joi.number().integer().required(), //站点编号
    amount: Joi.number().integer().allow(null), //明细总数量
    total: Joi.number().integer().allow(null), //对象总数量
    paid_account: Joi.number().integer().allow(null), //账单中已支付的金额，独立支付不属于账单以内的金额
    ori_account: Joi.number().allow(null), //原金额
    real_account: Joi.number().allow(null), //实际金额
    operator_id: Joi.number().integer().required(), //操作者编号
    pay_record_id: Joi.number().integer().allow(null), //对应的充值记录
    start_at: Joi.date().allow(null), //跨度类型的起始时间
    end_at: Joi.date().allow(null), //跨度类型的结束时间
    extend: Joi.string().allow(null), //扩展，总单编号列表，或者详细订单列表[就是当你某一票件你不需要打包的，你就把需要打包的id传递过去就可以了]
    status: Joi.number().integer().default(0), //状态
    paid_at: Joi.date().allow(null), //支付时间
    version: Joi.number().default(0), //版本
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const collection_bill_for_create = delete_property(Object.assign({}, collection_bill), ['id', 'created_at', 'updated_at', 'operator_id']);
const collection_bill_for_update = delete_property(Object.assign({}, collection_bill), ['id', 'user_id', 'station_id', 'created_at', 'updated_at', 'operator_id']);

//收款明细表【collection_records】
const collection_record = {
    id: Joi.number().integer().required(), //编号
    offer_type: Joi.number().integer().required().default(0), //提供的服务的类型，0订单
    offer_id: Joi.number().integer().required(), //提供的服务编号
    user_id: Joi.number().integer().allow(null), //用户编号
    station_id: Joi.number().integer().required(), //所属站点编号
    fund_type_id: Joi.number().integer().required(), //款项类型编号
    ori_account: Joi.number().required(), //原金额，当为到付的时候这个值代表如果直接付钱的金额
    real_account: Joi.number().required(), //实际金额，到付的时候这个值表示推给客户的佣金
    operator_id: Joi.number().integer().required(), //操作者编号
    pay_record_id: Joi.number().integer().allow(null), //对应的充值记录,现付的时候,这时用户编号可以为空
    station_card_id: Joi.number().integer().allow(null), //现金支付接收的卡编号
    bill_id: Joi.number().integer().allow(null), //归属账单编号，没有归属null
    type_id: Joi.number().integer().required().default(0), //类型 0现付、1账单、2现金、3到付
    is_added: Joi.number().integer().default(0), //是否加收 0默认不是加收，1加收如果对应对象状态已经是通过，然后现在添加就认为是加收
    status: Joi.number().integer().default(0), //状态 0已预算(账单的)已收货(到付的)，1作废，2未付，3已付'
    paid_at: Joi.date().allow(null), //支付时间
    comment: Joi.string().max(255).allow(null), //备注
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const collection_record_for_create = delete_property(Object.assign({}, collection_record), ['id', 'created_at', 'updated_at', 'operator_id']);
const collection_record_for_update = delete_property(Object.assign({}, collection_record), ['id', 'user_id', 'created_at', 'updated_at', 'operator_id']);

//收款明细表日志表【collection_records_logs】
const collection_record_log = {
    id: Joi.number().integer().required(), //编号
    record_id: Joi.number().integer().allow(null), //记录编号
    ori_account: Joi.number().allow(null), //原金额，当为到付的时候这个值代表如果直接付钱的金额
    real_account: Joi.number().allow(null), //实际金额，到付的时候这个值表示推给客户的佣金
    type_id: Joi.number().integer().required().default(0), //类型 0现付、1账单、2现金、3到付
    status: Joi.number().integer().default(0), //状态 0已预算(账单的)已收货(到付的)，1作废，2未付，3已付'
    comment: Joi.string().max(255).allow(null), //备注
    operator_id: Joi.number().integer().required(), //操作者编号
    created_at: Joi.date().required() //创建时间
};
const collection_record_log_for_create = delete_property(Object.assign({}, collection_record_log), ['id', 'created_at', 'operator_id']);
//付款明细表【payoff_records】
const payoff_record = {
    id: Joi.number().integer().required(), //编号
    offer_type: Joi.number().integer().required().default(0), //提供的服务的类型，0订单
    offer_id: Joi.number().integer().required(), //提供的服务编号[订单流水号]
    carrier_id: Joi.number().integer().required(), //用户编号【承运商】
    station_id: Joi.number().integer().required(), //所属站点编号
    fund_type_id: Joi.number().integer().required(), //款项类型编号
    ori_account: Joi.number().required(), //金额
    real_account: Joi.number().required(), //金额
    operator_id: Joi.number().integer().required(), //操作者编号
    bill_id: Joi.number().integer().allow(null), //归属账单编号，没有归属null
    status: Joi.number().integer().required().default(0), //状态 0已预算(账单的)已收货(到付的)，1作废，2未付，3已付'
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const payoff_record_for_create = delete_property(Object.assign({}, payoff_record), ['id', 'created_at', 'updated_at', 'operator_id']);
const payoff_record_for_update = delete_property(Object.assign({}, payoff_record), ['id', 'user_id', 'created_at', 'updated_at', 'operator_id']);

//付款账单表【payoff_bills】
const payoff_bill = {
    id: Joi.number().integer().required(), //编号
    type: Joi.number().integer().required().default(0), ////类型 [0总单账单，1周账单，2周账单 3日账单]
    extend: Joi.string().allow(null), //扩展，总单编号、时间跨度信息
    carrier_id: Joi.number().integer().required(), //用户编号【承运商】
    station_id: Joi.number().integer().required(), //站点编号
    amount: Joi.number().integer().allow(null), //数量
    self_account: Joi.number().integer().allow(null), //自己系统计算的金额
    receive_account: Joi.number().allow(null), //承运商给的金额
    real_account: Joi.number().allow(null), //最终确定的金额
    operator_id: Joi.number().integer().required(), //操作者编号 直接为当前登入的用户
    pay_record_id: Joi.number().integer().allow(null), //对应的充值记录
    status: Joi.number().integer().required().default(0), //状态
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const payoff_bill_for_create = delete_property(Object.assign({}, payoff_bill), ['id', 'created_at', 'updated_at', 'operator_id']);
const payoff_bill_for_update = delete_property(Object.assign({}, payoff_bill), ['id', 'carrier_id', 'created_at', 'updated_at', 'operator_id']);

//信用额度分配记录【credit_limit_records】
const credit_limit_record = {
    id: Joi.number().integer().required(), //编号
    offer_type: Joi.number().integer().required(), //提供者类型 0总公司，1站点，2员工
    offer_id: Joi.number().integer().required(), //提供者编号
    target_type: Joi.number().integer().required(), //接收者类型 0总公司，1站点，2员工 3客户
    target_id: Joi.number().integer().required(), //接收者编号
    account: Joi.number().allow(null), //总额
    returned_account: Joi.number().allow(null), //已归还额度
    type_id: Joi.number().integer().allow(null), //类型 用于临时或者长期有效
    operator_id: Joi.number().integer().allow(null), //操作者编号
    status: Joi.number().integer().required(), //状态
    comment: Joi.string().max(255).allow(null), //备注
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间
};
const credit_limit_record_for_create = delete_property(Object.assign({}, credit_limit_record), ['id', 'created_at', 'updated_at']);
//运输款项类型
const transport_fund_type = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required(), //名称
    description: Joi.string().max(255).allow(null), //描述
};

//用户充值记录表
const user_pay_record = {
    id: Joi.number().integer(), //编号
    user_id: Joi.number().integer().allow(null), //用户编号
    operator_id: Joi.number().integer().allow(null), //经办人编号
    account: Joi.number().integer().required(), //充值金额，用户支付了多少钱，退款金额，用户退款多少钱
    card_account: Joi.number().integer().allow(null), //卡金额，实际收到或付出多少钱
    real_account: Joi.number().integer().allow(null), //入账金额，给用户入账多少钱，给用户帐户扣掉多少钱
    pay_channel_id: Joi.number().integer().required(), //充值渠道编号
    user_account_no: Joi.string().max(50).allow(null), //用户充值账号 银行卡号、微信账号、支付宝账号等
    station_id: Joi.number().integer().allow(null), //实收站点编号， 如果为空则是给总公司，卡也对应到总公司的卡
    card_id: Joi.number().integer().required(), //实收卡编号
    type: Joi.number().integer().allow(null), //类型 [0 充值 1退款]
    comment: Joi.string().max(255).allow(null), //备注
    status: Joi.number().integer().allow(null), //状态 [0默认有效 1作废]
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间，作废时间
};

const user_pay_record_for_create = delete_property(Object.assign({}, user_pay_record), ['id', 'created_at', 'updated_at']);

//站点子帐号表信息(卡表)
const station_card = {
    id: Joi.number().integer().required(), //编号
    station_id: Joi.number().integer().allow(null), //所属站点编号
    balance: Joi.number().allow(null).default(0), //卡金额
    pay_channel_id: Joi.number().required(), //类型
    bank_name: Joi.string().max(50).required() , //开户行名称
    card_no: Joi.string().max(50).required() , //卡号
    owner_name: Joi.string().max(50).required(), //账户拥有者名字
    status: Joi.number().integer().default(0), //状态
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //更新时间，作废时间
};
const station_card_for_create = delete_property(Object.assign({}, station_card), ['id', 'created_at', 'updated_at']);
const station_card_for_change = {
    bank_name: Joi.string().max(50).allow(null) , //开户行名称
	card_no: Joi.string().max(50).allow(null) , //卡号
	owner_name: Joi.string().max(50).allow(null), //账户拥有者名字
	status: Joi.number().integer().allow(null).default(0), //状态
};
//支付渠道表
const pay_channel = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required() , //名称
    description: Joi.string().max(255).allow(null), //描述信息
};
const pay_channel_for_create = delete_property(Object.assign({}, pay_channel), ['id', 'created_at', 'updated_at']);
//订单分配类型表
const assign_type = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required()  //名称
};
//跟踪类型表
const trace_type = {
    id: Joi.number().integer().required(), //编号
    name: Joi.string().max(50).required(),  //名称
    homepage: Joi.string().max(255).required(), //主页
    track_network: Joi.string().max(255).allow(null), //跟踪网络地址
    batch_total: Joi.number().integer().allow(null), //批量总数
};
//跟踪信息表
const trace = {
    id: Joi.number().integer().required(), //编号
	transport_id: Joi.number().integer().required(), //跟踪编号
	trace_type_id: Joi.number().integer().required(), //跟踪网络类型编号
    trace_no: Joi.string().max(50).required(),  //跟踪的单号
    place: Joi.string().max(255).required(), //发生地点
	detail: Joi.string().max(255).required(), //事件详细信息
    happened_at: Joi.date().required(), //发生时间
    created_at: Joi.date().required() //创建时间
};
const trace_for_create = delete_property(Object.assign({}, trace), ['id', 'created_at']);
const trace_for_create_of = delete_property(Object.assign({}, trace), ['id', 'transport_id', 'created_at']);
const trace_for_create_of2 = delete_property(Object.assign({}, trace), ['id', 'transport_id', 'trace_no', 'created_at']);
//修改跟踪信息表
const trace_for_change = {
	transport_id: Joi.number().integer().allow(null), //订单编号
	trace_type_id: Joi.number().integer().allow(null), //跟踪网络类型编号
    trace_no: Joi.string().max(50).allow(null),  //跟踪的单号
    place: Joi.string().max(255).allow(null), //发生地点
	detail: Joi.string().max(255).allow(null), //事件详细信息
    happened_at: Joi.date().allow(null), //发生时间
    created_at: Joi.date().allow(null) //创建时间
};

//线路账号信息
const account_info = {
    secret: Joi.string().max(255).required(), //密码
    whCode: Joi.string().max(32).required(), //仓库编号
    mailType: Joi.string().max(255).required(), //电商标识
    ecCompanyId: Joi.string().max(255).required(), //电商标识,等同于中油要求的大客户编号
};

//线路单号分配账号表
const line_assign_account = {
    line_id: Joi.number().integer().required(), //线路编号
    type_id: Joi.number().integer().allow(null), //分配类型编号
   // account: Joi.object(account_info).allow(null), //存仓信息
    account: Joi.object().allow(null), //对接账号信息
    is_default: Joi.boolean().truthy(['Y', 'yes', '1', 1]).falsy(['N', 'no', '0', 0]).allow(null), //否默认地址
    created_at: Joi.date().required(), //创建时间
    updated_at: Joi.date().required() //修改时间
};
const line_assign_account_for_create = delete_property(Object.assign({}, line_assign_account), ['line_id', 'created_at', 'updated_at']);
const line_assign_account_for_change = delete_property(Object.assign({}, line_assign_account), ['created_at', 'updated_at']);
//模版类型表template_types
const template_type = {
    id: Joi.number().integer().required(), 	//编号
    name: Joi.string().max(50).required(),  //名称
	key_pair: Joi.object().required(), 		//模版关联到的变量对
	created_at: Joi.date().required() 		//创建时间
};
const template_type_for_create = delete_property(Object.assign({}, template_type), ['id', 'created_at']);

routers
    .use(
        '/users',
        router()
        //获得用户自身帐号信息
        .route({
            path: '/self',
            method: 'get',
            handler: handlers.users.getSelf(),
            validate: {
                output: {
                    // 200: {
                    //     body: user
                    // }
                }
            }
        })
        //修改个人帐号信息
        .route({
            path: '/self',
            method: ['put', 'patch'],
            handler: handlers.users.putSelf(),
            validate: {
                type: ['form', 'json'],
                body: Joi.object({
                    email: Joi.string().max(255).email().required() //用户邮箱
                }).min(1)
            }
        })
	//获得指定员工信息
	.route({
		path: '/staffs/:id',
		method: 'get',
		handler: handlers.users.getStaffsById(),
		validate: {
			params: {
				id: Joi.number().integer().required() //员工编号
			},
			output: {
				200: {
					body: staff
				}
			}
		}
	})
	//获得指定id员工详细信息
        .route({
            path: '/staff_infos/:id',
            method: 'get',
            handler: handlers.users.getStaffsById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工账号id
                },
                output: {
                    200: {
                        body: staff_info_for_get
                    }
                }
            }
        })
        //获得所有用户信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.users.getUsers(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(user)
                    }
                }
            }
        })
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.users.getUserAll(),
            validate: {
                query: {
					name: Joi.string().allow(null), //客户账号
                    business_id: Joi.number().integer().allow(null), //内部账户
					account_id: Joi.number().integer().allow(null), //财务账户
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(user, Joi.number().integer())
                    }
                }
            }
        })
		.route({
            path: '/desc/search/all',
            method: 'get',
            handler: handlers.users.getAllUsersByDesc(),
            validate: {
                query: {
					name: Joi.string().allow(null), //客户账号
                    business_id: Joi.number().integer().allow(null), //内部账户
					account_id: Joi.number().integer().allow(null), //财务账户
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(user, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定用户信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.users.getUserById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户编号
                },
                output: {
                    200: {
                        body: user
                    }
                }
            }
        })
        //添加用户信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.users.addUser(),
            validate: {
                type: ['form', 'json'],
                body: user_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //用户编号
                    }
                }
            }
        })
        //删除用户信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.users.deleteUserById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户编号
                }
            }
        })
        //修改用户信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.users.modifyUserById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户编号
                },
                type: ['form', 'json'],
                body: user_for_change
            }
        })
        .middleware()
    )
    .use(
        '/user_infos',
        router()
        //创建用户自身信息
        .route({
            path: '/self',
            method: ['post'],
            handler: handlers.user_infos.createSelfInfo(),
            validate: {
                type: ['form', 'json'],
                body: user_info
            }
        })
        //获得用户自身信息
        .route({
            path: '/self/:user_id',
            method: 'get',
            handler: handlers.user_infos.getSelfInfoById(),
            validate: {
                output: {
                    200: {
                        body: user_info_with_time
                    }
                }
            }
        })
        //修改用户自身信息
        .route({
            path: '/self',
            method: ['put', 'patch'],
            handler: handlers.user_infos.modifyUserInfoById(),
            validate: {
                type: ['form', 'json'],
                body: Joi.object(user_info_for_change).min(1)
            }
        })
        .middleware()
    )
    .use(
        '/user_types',
        router()
        //获得用户类型信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.user_types.getUserTypes(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(user_type_with_time)
                    }
                }
            }
        })
        //获得用户类型信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.user_types.getUserTypesById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //类型编号
                },
                output: {
                    200: {
                        body: user_type_with_time
                    }
                }
            }
        })
        .middleware()
    )
    /*.use(
        '/user_level_types',
        router()
        //获得用户自己的类型等级信息
        .route({
            path: '/self',
            method: 'get',
            handler: [verify, controllers.Generals.index_of('user_level_types', Object.keys(user_level_type), { user_id: '$self.user_id' })],
            validate: {
                output: {
                    200: {
                        body: user_level_type
                    }
                }
            }
        })
        .middleware()
    )*/
    .use(
        '/user_accounts',
        router()
        //获得用户自己的账户信息
        .route({
            path: '/self',
            method: 'get',
            handler: handlers.user_accounts.getSelf(),
            validate: {
                output: {
                    200: {
                        body: user_account
                    }
                }
            }
        })
        .middleware()
    )

    .use(
        '/send_addresses',
        router()
        //创建发送地址信息
        .route({
            path: '/self',
            method: ['post'],
            handler: handlers.send_addresses.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: send_address_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //获取发送地址信息
        .route({
            path: '/self',
            method: 'get',
            handler: handlers.send_addresses.getSelf(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(send_address_with_time)
                    }
                }
            }
        })
        //获取指定id自身的发送地址信息
        .route({
            path: '/self/:id',
            method: 'get',
            handler: handlers.send_addresses.getSelfById(),
            validate: {
		            params: {
                    id: Joi.number().integer().required() //发送地址编号
                },
                output: {
                    200: {
                        body: send_address_with_time
                    }
                }
            }
        })
        //修改发送地址信息
        .route({
            path: '/self/:id',
            method: ['put', 'patch'],
            handler: handlers.send_addresses.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //发送地址编号
                },
                type: ['form', 'json'],
                body: Joi.object(send_address_for_change).min(1)
            }
        })
        //删除发送地址信息
        .route({
            path: '/self/:id',
            method: 'delete',
            handler: handlers.send_addresses.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //发送地址编号
                }
            }
        })
        //批量删除发送地址信息
        .route({
            path: '/self/datch/:ids',
            method: ['delete'],
            handler: handlers.send_addresses.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //发送地址编号
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/receive_addresses',
        router()
        //创建接收地址信息
        .route({
            path: '/self',
            method: ['post'],
            handler: handlers.receive_addresses.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: receive_address_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //获取接收地址信息
        .route({
            path: '/self',
            method: 'get',
            handler: handlers.receive_addresses.getSelf(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(receive_address_with_time)
                    }
                }
            }
        })
        //获取接收地址信息
        .route({
            path: '/self/:id',
            method: 'get',
            handler: handlers.receive_addresses.getSelfById(),
            validate: {
		            params: {
                    id: Joi.number().integer().required() //接收地址编号
                },
                output: {
                    200: {
                        body: receive_address_with_time
                    }
                }
            }
        })
        //修改接收地址信息
        .route({
            path: '/self/:id',
            method: ['put', 'patch'],
            handler: handlers.receive_addresses.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //接收地址编号
                },
                type: ['form', 'json'],
                body: Joi.object(receive_address_for_change).min(1)
            }
        })
        //删除接收地址信息
        .route({
            path: '/self/:id',
            method: 'delete',
            handler: handlers.receive_addresses.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //接收地址编号
                }
            }
        })
         //批量删除接收地址信息
        .route({
            path: '/self/datch/:ids',
            method: ['delete'],
            handler: handlers.receive_addresses.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //接收地址编号
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //获取指定id的接收地址信息
        .route({
            path: '/id/:id',
            method: 'get',
            handler: handlers.receive_addresses.getById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //接收地址编号
                },
                output: {
                    200: {
                        body: receive_address_with_time
                    }
                }
            }
        })
        //删除接收地址信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.receive_addresses.deleteById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //接收地址编号
                }
            }
        })
        //修改接收地址信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.receive_addresses.modifyById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //接收地址编号
                },
                type: ['form', 'json'],
                body: receive_address_for_change
            }
        })
        .middleware()
    )
    .use(
        '/login',
        router()
        //用户登录
        .route({
            path: '/',
            method: 'post',
            handler: handlers.users.login(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    password: Joi.string().min(6).max(50).required() //密码
                },
                output: {
                    200: {
                        body: {
                            token: Joi.string() //验证码
                        }
                    }
                }
            }
        })
        .middleware()
    )
    //用户登出
    .post('/logout', verify, controllers.Logout.index)
    .use(
        '/register',
        router()
        //用户注册
        .route({
            path: '/',
            method: 'post',
            handler: handlers.users.register(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    password: Joi.string().min(6).max(50).required(), //密码
                    email: Joi.string().max(255).lowercase().email() //邮箱
                }
            }
        })
        .middleware()
    )
    .use(
        '/change_password',
        router()
        //修改密码
        .route({
            path: '/',
            method: 'post',
            handler: handlers.users.changePassword(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    old_password: Joi.string().min(6).max(50).required(), //老密码
                    new_password: Joi.string().min(6).max(50).required() //新密码
                }
            }
        })
        .middleware()
    )
    .use(
        '/unregister',
        router()
        //用户注销
        .route({
            path: '/',
            method: 'post',
            handler: handlers.users.unregister(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    password: Joi.string().min(6).max(50).required() //密码
                }
            }
        })
        .middleware()
    )
    .use(
        '/countrys',
        router()
        //获得所有国家信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.countrys.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(country)
                    }
                }
            }
        })
        //获得指定国家信息
        .route({
            path: '/:id',
            method: 'get',
            handler:handlers.countrys.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: country
                    }
                }
            }
        })
        //添加国家信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.countrys.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: country_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //国家编号
                    }
                }
            }
        })
        //删除国家信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.countrys.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                }
            }
        })
        //批量删除国家信息，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.countrys.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //countrys表的id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //修改国家信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.countrys.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                type: ['form', 'json'],
                body: country_for_change
            }
        })
        .middleware()
    )
    .use(
        '/provinces',
        router()
        //获得所有省州信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.provinces.getAll(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(province, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有省州信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.provinces.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(province, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定省州信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.provinces.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //省州编号
                },
                output: {
                    200: {
                        body: province
                    }
                }
            }
        })
        //获得指定国家所有省州信息
        .route({
            path: '/country/:id',
            method: 'get',
            handler: handlers.provinces.getSelfByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(province)
                    }
                }
            }
        })
        //添加国家下属的省州信息
        .route({
            path: '/country/:id',
            method: ['post'],
            handler: handlers.provinces.addSelfByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                type: ['form', 'json'],
                body: province_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //省州编号
                    }
                }
            }
        })
        //删除省州信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.provinces.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //省州编号
                }
            }
        })
        //修改省州信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.provinces.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //省州编号
                },
                type: ['form', 'json'],
                body: province_for_change
            }
        })
        .middleware()
    )
    .use(
        '/citys',
        router()
        //获得所有城市信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.citys.getAll(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(city, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有城市信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.citys.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(city, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定城市信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.citys.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                output: {
                    200: {
                        body: city
                    }
                }
            }
        })
        //获得指定国家所有城市信息
        .route({
            path: '/country/:id',
            method: 'get',
            handler: handlers.citys.getSelfByCountryId(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(city, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定国家所有城市信息
        .route({
            path: '/country/:id/page/:size?/:page?',
            method: 'get',
            handler: handlers.citys.getSelfByCountryIdPage(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //国家编号
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(city, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定省州所有城市信息
        .route({
            path: '/province/:id',
            method: 'get',
            handler: handlers.citys.getSelfByProvinceId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //省州编号
                },
                output: {
                    200: {
                        body: Joi.array().items(city)
                    }
                }
            }
        })
        //添加国家下属的城市信息
        .route({
            path: '/country/:id',
            method: ['post'],
            handler: handlers.citys.addSelfByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                type: ['form', 'json'],
                body: city_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //城市编号
                    }
                }
            }
        })
        //删除城市信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.citys.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                }
            }
        })
        //修改城市信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.citys.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                type: ['form', 'json'],
                body: city_for_change
            }
        })
        .middleware()
    )
    .use(
        '/countys',
        router()
        //获得所有区县信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.countys.getAll(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(county, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有区县信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.countys.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(county, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定区县信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.countys.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //区县编号
                },
                output: {
                    200: {
                        body: county
                    }
                }
            }
        })
        //获得指定城市所有区县信息
        .route({
            path: '/city/:id',
            method: 'get',
            handler: handlers.countys.getSelfByCityId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                output: {
                    200: {
                        body: Joi.array().items(county)
                    }
                }
            }
        })
        //获得指定区县管辖的所有区县信息
        .route({
            path: '/super/:id',
            method: 'get',
            handler: handlers.countys.getAllBySuperId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //上级区县编号
                },
                output: {
                    200: {
                        body: Joi.array().items(county)
                    }
                }
            }
        })
        //添加城市下属的区县信息
        .route({
            path: '/city/:id',
            method: ['post'],
            handler: handlers.countys.addSelfByCityId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                type: ['form', 'json'],
                body: county_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //区县编号
                    }
                }
            }
        })
        //删除区县信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.countys.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //区县编号
                }
            }
        })
        //修改区县信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.countys.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //区县编号
                },
                type: ['form', 'json'],
                body: county_for_change
            }
        })
        .middleware()
    )
    .use(
        '/united_addresses',
        router()
        //获得所有统一地址信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.united_addresses.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(united_address)
                    }
                }
            }
        })
        //获得指定地址信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.united_addresses.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: united_address
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/postcodes',
        router()
        //获得所有邮编信息
        .route({
            path: '/code/:code/:country_id?',
            method: 'get',
            handler: handlers.postcodes.getAllPageByCountryId(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                params: {
                    code: Joi.number().integer().required(), //邮编，从左匹配
                    country_id: Joi.number().integer() //所属国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(postcode, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有邮编信息
        .route({
            path: '/code/:code/:country_id?/page/:size?/:page?',
            method: 'get',
            handler: handlers.postcodes.getAllPageByCountryId(),
            validate: {
                params: {
                    code: Joi.number().integer().required(), //邮编，从左匹配
                    country_id: Joi.number().integer(), //所属国家编号
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(postcode, Joi.number().integer())
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/remotes',
        router()
        //查询是否偏远
        .route({
            path: '/code/:code/:country_id',
            method: 'get',
            handler: handlers.postcodes.remotesByCodeCountryId(),
            validate: {
                params: {
                    code: Joi.number().integer().required(), //邮编，从左匹配
                    country_id: Joi.number().integer().required(), //所属国家编号
                },
                output: {
                    200: {
                        body: Joi.boolean()
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/channels',
        router()
        //获得所有渠道信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.channels.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(channel)
                    }
                }
            }
        })
        //获得指定渠道信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.channels.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: channel
                    }
                }
            }
        })
        //获得指定渠道下的服务类型
        .route({
            path: '/:id/service_type',
            method: 'get',
            handler: handlers.channels.getServiceTypeById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(service_type_with_time)
                    }
                }
            }
        })
        //获得指定渠道下的线路
        .route({
            path: '/:id/line',
            method: 'get',
            handler: handlers.channels.getLineById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得指定渠道下的销售产品
        .route({
            path: '/:id/sell_product',
            method: 'get',
            handler: handlers.channels.getSellProductById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time)
                    }
                }
            }
        })
        //创建渠道信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.channels.createChannels(),
            validate: {
                type: ['form', 'json'],
                body: channel_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //渠道编号
                    }
                }
            }
        })
        //删除渠道信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.channels.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //渠道编号
                }
            }
        })
        //修改渠道信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.channels.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //渠道编号
                },
                type: ['form', 'json'],
                body: channel_for_change
            }
        })
        .middleware()
    )
    .use(
        '/zones',
        router()
        //获得指定分区信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.zones.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.object(zone).unknown(true)
                    }
                }
            }
        })
        //获得指定分区信息
        .route({
            path: '/list/:id',
            method: 'get',
            handler: handlers.zones.getListById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                /*output: {
                    200: {
                      body: zone
                    }
                      }*/
            }
        })
        //获得一个服务类型的所有分区信息
        .route({
            path: '/service_type/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeById(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //获得一个线路的所有分区信息
        .route({
            path: '/line/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeById(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //获得一个销售产品的所有分区信息
        .route({
            path: '/sell_product/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeById(2),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //获得一个服务类型的所有分区信息
        .route({
            path: '/list/service_type/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeListById(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                /*output: {
                  200: {
                    body: Joi.array().items(zone)
                  }
                    }*/
            }
        })
        //获得一个线路的所有分区信息
        .route({
            path: '/list/line/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeListById(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                /*output: {
                  200: {
                    body: Joi.array().items(zone)
                  }
                    }*/
            }
        })
        //获得一个销售产品的所有分区信息
        .route({
            path: '/list/sell_product/:id',
            method: 'get',
            handler: handlers.zones.getServiceTypeListById(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                /*output: {
                  200: {
                    body: Joi.array().items(zone)
                  }
                    }*/
            }
        })
        //创建指定的服务类别下的分区
        .route({
            path: '/service_type/:id',
            method: 'post',
            handler: handlers.zones.createSelfByTypeId(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: zone_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //创建指定的线路下的分区
        .route({
            path: '/line/:id',
            method: 'post',
            handler: handlers.zones.createSelfByTypeId(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                type: ['form', 'json'],
                body: zone_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //创建指定的销售产品下的分区
        .route({
            path: '/sell_product/:id',
            method: 'post',
            handler: handlers.zones.createSelfByTypeId(2),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                },
                type: ['form', 'json'],
                body: zone_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //创建指定的服务类别下的多个分区
        .route({
            path: '/batch/service_type/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_for_create).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //创建指定的线路下的多个分区
        .route({
            path: '/batch/line/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_for_create).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //创建指定的销售产品下的多个分区
        .route({
            path: '/batch/sell_product/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId(2),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_for_create).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //创建指定的服务类别下的分区
        .route({
            path: '/list/service_type/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId1(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_country_cell).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //创建指定的线路下的分区
        .route({
            path: '/list/line/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId1(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_country_cell).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //创建指定的销售产品下的分区
        .route({
            path: '/list/sell_product/:id',
            method: 'post',
            handler: handlers.zones.batchSelfByTypeId1(2),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(zone_country_cell).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //删除指定服务类别的所有分区信息
        .route({
            path: '/service_type/:id',
            method: ['delete'],
            handler: handlers.zones.deleteSelfByTypeId(0),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                }
            }
        })
	//删除指定线路的所有分区信息
        .route({
            path: '/line/:id',
            method: ['delete'],
            handler: handlers.zones.deleteSelfByTypeId(1),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                }
            }
        })
	//删除指定销售产品的所有分区信息
        .route({
            path: '/sell_product/:id',
            method: ['delete'],
            handler: handlers.zones.deleteSelfByTypeId(2),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                }
            }
        })
        //删除分区信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.zones.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //分区编号
                }
            }
        })
        //修改分区信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.zones.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //分区编号
                },
                type: ['form', 'json'],
                body: zone_for_change
            }
        })
        //分区添加国家
        .route({
            path: '/:id/country',
            method: ['put', 'patch'],
            handler: handlers.zones.addSelfByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //分区编号
                },
                type: ['form', 'json'],
                body: zone_country_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //分区删除国家
        .route({
            path: '/:id/country/:zone_country_id',
            method: ['put', 'patch', 'delete'],
            handler: handlers.zones.deleteCountryById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //分区编号
                    zone_country_id: Joi.number().integer().required() //分区国家编号
                }
            }
        })
        .middleware()
    )
    .use(
        '/service_types',
        router()
        //获得所有服务类别信息
        .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.service_types.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(service_type_with_time)
                    }
                }
            }
        })
        //获得所有服务类别信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.service_types.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(1000).default(1000), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(service_type_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有服务类别信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.service_types.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(1000).default(1000), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(service_type_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定渠道的下属服务类别
        .route({
            path: '/channel/:id',
            method: 'get',
            handler: handlers.service_types.getSelfByChannelsId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(service_type_with_time)
                    }
                }
            }
        })
        //获得指定服务类别
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.service_types.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                output: {
                    200: {
                        body: service_type_with_time
                    }
                }
            }
        })
        //获得服务类别下属的所有分区
        .route({
            path: '/:id/zone',
            method: 'get',
            handler: handlers.service_types.getAllZoneById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //创建指定服务类型
        .route({
            path: '/',
            method: 'post',
            handler: handlers.service_types.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: service_type_for_change,
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //删除指定服务类别
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.service_types.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                }
            }
        })
        //修改定服务类别信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.service_types.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: service_type_for_change
            }
        })
        .middleware()
    )
    .use(
        '/currencys',
        router()
        //获得所有货币信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.currencys.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(currency)
                    }
                }
            }
        })
        //获得指定货币信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.currencys.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //货币编号
                },
                output: {
                    200: {
                        body: currency
                    }
                }
            }
        })
        //添加货币信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.currencys.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: currency_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //货币编号
                    }
                }
            }
        })
        //删除货币信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.currencys.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //货币编号
                }
            }
        })
        //批量删除货币信息，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.currencys.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //currencys表的id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //修改货币信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.currencys.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //货币编号
                },
                type: ['form', 'json'],
                body: currency_for_change
            }
        })
        .middleware()
    )
    .use(
        '/publish_prices',
        router()
        //获得指定公布价信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.publish_prices.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: publish_price
                    }
                }
            }
        })
        .route({
            path: '/name/:id',
            method: 'get',
            handler: handlers.publish_prices.getSelfByNameId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: publish_price_without_stages
                    }
                }
            }
        })
        //获得一个服务类型的所有公布价信息
        .route({
            path: '/service_type/:id',
            method: 'get',
            handler: handlers.publish_prices.getSelfByServiceTypeId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类型编号
                },
                output: {
                    200: {
                        body: Joi.array().items(publish_price)
                    }
                }
            }
        })
        //创建指定的服务类别下的公布价
        .route({
            path: '/service_type/:id',
            method: 'post',
            handler: handlers.publish_prices.createSelfByServiceTypeId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: publish_price_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除公布价
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.publish_prices.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //公布价编号
                }
            }
        })
        //修改公布价
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //公布价编号
                },
                type: ['form', 'json'],
                body: publish_price_for_change
            }
        })
        //启用公布价信息
        .route({
            path: '/:id/enable',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.enableSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //公布价编号
                }
            }
        })
        //停用公布价信息
        .route({
            path: '/:id/stop',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.stopSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //公布价编号
                }
            }
        })
        //锁定公布价信息
        .route({
            path: '/:id/lock',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.lockSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //公布价编号
                }
            }
        })
        //修改公布价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.modifySelfStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //编号
                    stage_id: Joi.number().integer().required() //区段编号
                },
                type: ['form', 'json'],
                body: publish_price_stage_for_change
            }
        })
        //添加公布价分段
        .route({
            path: '/:id/stage',
            method: ['put', 'patch'],
            handler: handlers.publish_prices.addStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: publish_price_stage_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除公布价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['delete'],
            handler: handlers.publish_prices.deleteStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //编号
                    stage_id: Joi.number().integer().required() //区段编号
                }
            }
        })
        //用户获得指定起始点和终点及重量的所有公布价信息
        .route({
            path: '/select_price/:src_country_id/:dest_place_id/:weight/:type',
            method: 'get',
            handler: handlers.publish_prices.getAllByCondition(),
            validate: {
                params: {
                    src_country_id: Joi.number().integer().required(), //起点国家编号
                    dest_place_id: Joi.number().integer(), //终点地址编号
                    weight: Joi.number().required(), //重量
                    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
                },
                query: {
                    src_place_id: Joi.number().integer(), //起点地址编号
                    dest_post_code: Joi.string(), //终点城市邮编
                    service_type_id: Joi.number().integer(), //快递类别编号
                    channel_id: Joi.number().integer() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(publish_price_result)
                    }
                }
            }
        })
        //试算指定起始点和终点及重量的所有公布价信息
        .route({
            path: '/check_price/:src_country_id/:dest_place_id/:weight/:type',
            method: 'get',
            handler: handlers.publish_prices.figureByCondition(),
            validate: {
                params: {
                    src_country_id: Joi.number().integer().required(), //起点国家编号
                    dest_place_id: Joi.number().integer().required(), //终点地址编号
                    weight: Joi.number().required(), //重量
                    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
                },
                query: {
                    src_place_id: Joi.number().integer(), //起点地址编号
                    dest_post_code: Joi.string(), //终点城市邮编
                    publish_price_id: Joi.number().integer(), //指定公布价编号
                    service_type_id: Joi.number().integer(), //快递类别编号
                    channel_id: Joi.number().integer() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(publish_price_result)
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/carriers',
        router()
        //获得所有承运商信息
        .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.carriers.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(carrier_with_time)
                    }
                }
            }
        })
        //获得所有承运商信息(分页)
        .route({
            path: '/',
            method: 'get',
            handler: handlers.carriers.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有承运商信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.carriers.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定承运商信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.carriers.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商编号
                },
                output: {
                    200: {
                        body: carrier_with_time
                    }
                }
            }
        })
        //添加承运商信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.carriers.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: carrier_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //承运商编号
                    }
                }
            }
        })
        //删除承运商信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.carriers.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商编号
                }
            }
        })
        //修改承运商信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.carriers.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商编号
                },
                type: ['form', 'json'],
                body: carrier_for_change
            }
        })
        .middleware()
    )
    .use(
        '/stations',
        router()
        //获得所有站点信息
        .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.stations.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(station)
                    }
                }
            }
        })
        //获得所有站点信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.stations.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(station, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有站点信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.stations.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(station, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定站点信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.stations.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //站点编号
                },
                output: {
                    200: {
                        body: station
                    }
                }
            }
        })
        //获得指定国家所有站点信息
        .route({
            path: '/country/:id',
            method: 'get',
            handler: handlers.stations.getSelfByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(station)
                    }
                }
            }
        })
        //获得指定城市所有站点信息
        .route({
            path: '/city/:id',
            method: 'get',
            handler: handlers.stations.getSelfByCityId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                output: {
                    200: {
                        body: Joi.array().items(station)
                    }
                }
            }
        })
        //添加站点信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.stations.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: station_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //站点编号
                    }
                }
            }
        })
        //删除站点信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.stations.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //站点编号
                }
            }
        })
        //修改站点信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.stations.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //站点编号
                },
                type: ['form', 'json'],
                body: station_for_change
            }
        })
        .middleware()
    )
    .use(
        '/carrier_stations',
        router()
        //获得所有承运商站点信息
		    .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.carrier_stations.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //获得所有承运商站点信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.carrier_stations.getAllDefaultPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station_with_name, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有承运商站点信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.carrier_stations.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定承运商站点信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.carrier_stations.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商站点编号
                },
                output: {
                    200: {
                        body: carrier_station
                    }
                }
            }
        })
        //获得承运商下属站点信息
        .route({
            path: '/carrier/:id',
            method: 'get',
            handler: handlers.carrier_stations.getAllByCarriersId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商编号
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //获得指定国家所有承运商站点信息
        .route({
            path: '/country/:id',
            method: 'get',
            handler: handlers.carrier_stations.getAllByCountryId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //获得指定城市所有承运商站点信息
        .route({
            path: '/city/:id',
            method: 'get',
            handler: handlers.carrier_stations.getAllByCityId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //城市编号
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //获得指定国家指定承运商所有站点信息
        .route({
            path: 'carrier/:carrier_id/country/:country_id',
            method: 'get',
            handler: handlers.carrier_stations.getAllByCountryIdAndCarrierId(),
            validate: {
                params: {
                    carrier_id: Joi.number().integer().required(), //承运商编号
                    country_id: Joi.number().integer().required() //国家编号
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //获得指定城市指定承运商所有站点信息
        .route({
            path: 'carrier/:carrier_id/city/:city_id',
            method: 'get',
            handler: handlers.carrier_stations.getAllByCityIdAndCarrierId(),
            validate: {
                params: {
                    carrier_id: Joi.number().integer().required(), //承运商编号
                    city_id: Joi.number().integer().required() //城市编号
                },
                output: {
                    200: {
                        body: Joi.array().items(carrier_station)
                    }
                }
            }
        })
        //添加承运商下属站点信息
        .route({
            path: '/carrier/:id',
            method: ['post'],
            handler: handlers.carrier_stations.addSelfByCarrierId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商编号
                },
                type: ['form', 'json'],
                body: carrier_station_for_change,
                output: {
                    200: {
                        body: Joi.number().integer() //承运商站点编号
                    }
                }
            }
        })
        //删除承运商站点信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.carrier_stations.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商站点编号
                }
            }
        })
        //修改承运商站点信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.carrier_stations.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //承运商站点编号
                },
                type: ['form', 'json'],
                body: carrier_station_for_change
            }
        })
        .middleware()
    )
    .use(
        '/lines',
        router()
        //获得所有运营线路信息
        .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.lines.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得所有运营线路信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.lines.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有运营线路信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.lines.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定运营线路信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.lines.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: line_with_time
                    }
                }
            }
        })
        //获得指定承运商的所有运营线路信息
        .route({
            path: '/carrier/:id',
            method: 'get',
            handler: handlers.lines.getAllByCarriersId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得指定渠道的所有运营线路信息
        .route({
            path: '/channel/:id',
            method: 'get',
            handler: handlers.lines.getAllByChannelsId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得指定服务类型的所有运营线路信息
        .route({
            path: '/service_type/:id',
            method: 'get',
            handler: handlers.lines.getAllByServiceTypeId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得指定承运商指定渠道的所有运营线路信息
        .route({
            path: '/carrier/:id/channel/:channel_id',
            method: 'get',
            handler: handlers.lines.getAllByChannelIdAndCarrierId(),
            validate: {
                params: {
                    id: Joi.number().integer().required(),
                    channel_id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得指定承运商指定服务类型的所有运营线路信息
        .route({
            path: '/carrier/:id/service_type/:service_type_id',
            method: 'get',
            handler: handlers.lines.getAllByCarrierIdAndServiceTypeId(),
            validate: {
                params: {
                    id: Joi.number().integer().required(),
                    service_type_id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(line_with_time)
                    }
                }
            }
        })
        //获得线路下属的所有分区
        .route({
            path: '/:id/zone',
            method: 'get',
            handler: handlers.lines.getAllByZoneId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //创建指定承运商的下属线路
        .route({
            path: '/carrier/:id',
            method: 'post',
            handler: handlers.lines.createSelfByCarrierId(),
            validate: {
                type: ['form', 'json'],
                body: line_for_change,
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //删除指定线路
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.lines.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                }
            }
        })
        //修改指定线路信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.lines.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: line_for_change
            }
        })
        .middleware()
    )
    .use(
        '/cost_prices',
        router()
        //获得指定成本价信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.cost_prices.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: cost_price
                    }
                }
            }
        })
        .route({
            path: '/name/:id',
            method: 'get',
            handler: handlers.cost_prices.getSelfByNameId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: cost_price_without_stages
                    }
                }
            }
        })
        //获得一个线路的所有成本价信息
        .route({
            path: '/line/:id',
            method: 'get',
            handler: handlers.cost_prices.getSelfByLineId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                output: {
                    200: {
                        body: Joi.array().items(cost_price)
                    }
                }
            }
        })
        //创建指定的线路的成本价
        .route({
            path: '/line/:id',
            method: 'post',
            handler: handlers.cost_prices.createSelfByLineId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                type: ['form', 'json'],
                body: cost_price_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除成本价
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.cost_prices.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价编号
                }
            }
        })
        //修改成本价
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价编号
                },
                type: ['form', 'json'],
                body: cost_price_for_change
            }
        })
        //启用成本价信息
        .route({
            path: '/:id/enable',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.enableSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价编号
                }
            }
        })
        //停用成本价信息
        .route({
            path: '/:id/stop',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.stopSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价编号
                }
            }
        })
        //锁定成本价信息
        .route({
            path: '/:id/lock',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.lockSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价编号
                }
            }
        })
        //修改成本价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.modifyStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //编号
                    stage_id: Joi.number().integer().required() //区段编号
                },
                type: ['form', 'json'],
                body: cost_price_stage_for_change
            }
        })
        //添加成本价分段
        .route({
            path: '/:id/stage',
            method: ['put', 'patch'],
            handler: handlers.cost_prices.addStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //成本价区段编号
                },
                type: ['form', 'json'],
                body: cost_price_stage_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除成本价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['delete'],
            handler: handlers.cost_prices.deleteStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //成本价编号
                    stage_id: Joi.number().integer().required() //区段编号
                }
            }
        })
        //试算指定起始点和终点及重量的所有成本价信息
        .route({
            path: '/check_price/:src_country_id/:dest_place_id/:weight/:type',
            method: 'get',
            handler: handlers.cost_prices.figureByCondition(),
            validate: {
                params: {
                    src_country_id: Joi.number().integer().required(), //起点国家编号
                    dest_place_id: Joi.number().integer().required(), //终点地址编号
                    weight: Joi.number().required(), //重量
                    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
                },
                query: {
                    src_place_id: Joi.number().integer(), //起点地址编号
                    dest_post_code: Joi.string(), //终点城市邮编
                    carrier_id: Joi.number().integer(), //承运商编号
                    line_id: Joi.number().integer(), //运营线路编号
                    cost_price_id: Joi.number().integer(), //指定成本价编号
                    service_type_id: Joi.number().integer(), //快递类别编号
                    channel_id: Joi.number().integer() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(cost_price_result)
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/sell_products',
        router()
        //获得所有销售产品信息
        .route({
            path: '/show/all',
            method: 'get',
            handler: handlers.sell_products.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time)
                    }
                }
            }
        })
        //获得所有销售产品信息（分页）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.sell_products.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有销售产品信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.sell_products.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定销售产品信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.sell_products.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: sell_product_with_time
                    }
                }
            }
        })
        //获得指定渠道的所有销售产品信息
        .route({
            path: '/channel/:id',
            method: 'get',
            handler: handlers.sell_products.getSelfByChannelId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time)
                    }
                }
            }
        })
        //获得指定服务类型的所有销售产品信息
        .route({
            path: '/service_type/:id',
            method: 'get',
            handler: handlers.sell_products.getSelfByServiceTypeId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time)
                    }
                }
            }
        })
        //获得指定线路对应的销售产品信息
        .route({
            path: '/line/:id',
            method: 'get',
            handler: handlers.sell_products.getSelfByLineId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_product_with_time)
                    }
                }
            }
        })
        //获得销售产品下属的所有分区
        .route({
            path: '/:id/zone',
            method: 'get',
            handler: handlers.sell_products.getSelfByZoneId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路编号
                },
                output: {
                    200: {
                        body: Joi.array().items(zone)
                    }
                }
            }
        })
        //创建销售产品
        .route({
            path: '/',
            method: 'post',
            handler: handlers.sell_products.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: sell_product_for_create,
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //删除指定销售产品
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.sell_products.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                }
            }
        })
        //修改指定销售产品
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.sell_products.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: sell_product_for_change
            }
        })
        .middleware()
    )
    .use(
        '/sell_prices',
        router()
        //获得指定销售价信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.sell_prices.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: sell_price
                    }
                }
            }
        })
        .route({
            path: '/name/:id',
            method: 'get',
            handler: handlers.sell_prices.getSelfByNameId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: sell_price_without_stages
                    }
                }
            }
        })
        //获得指定销售价某个等级的信息
        .route({
            path: '/:id/level/:level',
            method: 'get',
            handler: handlers.sell_prices.getSelfByLeveId(),
            validate: {
                params: {
                    id: Joi.number().integer().required(),
                    level: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: sell_price
                    }
                }
            }
        })
        //获得指定用户销售价的信息
        .route({
            path: '/:id/user/:user_id',
            method: 'get',
            handler: handlers.sell_prices.getSelfByUserId(),
            validate: {
                params: {
                    id: Joi.number().integer().required(),
                    user_id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: sell_price
                    }
                }
            }
        })
        //获得一个线路的所有销售价信息
        .route({
            path: '/sell_product/:id',
            method: 'get',
            handler: handlers.sell_prices.getAllBySellProductId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_price)
                    }
                }
            }
        })

        //获得一个销售产品的所有销售价信息（不带价格明细）
        .route({
            path: '/name/sell_product/:id',
            method: 'get',
            handler: handlers.sell_prices.getAllNameBySellProductId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售产品编号
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_price_without_stages)
                    }
                }
            }
        })
        //创建指定的线路的销售价
        .route({
            path: '/sell_product/:id',
            method: 'post',
            handler: handlers.sell_prices.createSelfBySellProductId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //服务类别编号
                },
                type: ['form', 'json'],
                body: sell_price_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除销售价
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.sell_prices.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售价编号
                }
            }
        })
        //修改销售价
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售价编号
                },
                type: ['form', 'json'],
                body: sell_price_for_change
            }
        })
        //启用销售价信息
        .route({
            path: '/:id/enable',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.enableSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售价编号
                }
            }
        })
        //停用销售价信息
        .route({
            path: '/:id/stop',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.stopSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售价编号
                }
            }
        })
        //锁定销售价信息
        .route({
            path: '/:id/lock',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.lockSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //销售价编号
                }
            }
        })
        //修改销售价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.modifyStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //编号
                    stage_id: Joi.number().integer().required() //区段编号
                },
                type: ['form', 'json'],
                body: sell_price_stage_for_change
            }
        })
        //添加销售价分段
        .route({
            path: '/:id/stage',
            method: ['put', 'patch'],
            handler: handlers.sell_prices.addStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: sell_price_stage_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //编号
                    }
                }
            }
        })
        //删除销售价分段
        .route({
            path: '/:id/stage/:stage_id',
            method: ['delete'],
            handler: handlers.sell_prices.deleteStageById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //编号
                    stage_id: Joi.number().integer().required() //区段编号
                }
            }
        })
        //用户获得指定起始点和终点及重量的所有销售价信息
        .route({
            path: '/select_price/:src_country_id/:dest_place_id/:weight/:type',
            method: 'get',
            handler: handlers.sell_prices.getAllByCondition(),
            validate: {
                params: {
                    src_country_id: Joi.number().integer().required(), //起点国家编号
                    dest_place_id: Joi.number().integer(), //终点地址编号
                    weight: Joi.number().required(), //重量
                    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
                },
                query: {
                    src_place_id: Joi.number().integer(), //起点地址编号
                    dest_post_code: Joi.string(), //终点城市邮编
                    sell_product_id: Joi.number().integer(), //销售产品编号
                    service_type_id: Joi.number().integer(), //快递类别编号
                    channel_id: Joi.number().integer() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_price_result)
                    }
                }
            }
        })
        //试算指定起始点和终点及重量的所有销售价信息
        .route({
            path: '/check_price/:src_country_id/:dest_place_id/:weight/:type',
            method: 'get',
            handler: handlers.sell_prices.figureByCondition(),
            validate: {
                params: {
                    src_country_id: Joi.number().integer().required(), //起点国家编号
                    dest_place_id: Joi.number().integer(), //终点地址编号
                    weight: Joi.number().required(), //重量
                    type: Joi.string().replace('package', '0').replace('document', '1').replace('bag', '2').valid(['0', '1', '2', 0, 1, 2]).default(0).required(), //货品类型(默认包裹0、文件1、防水袋2)
                },
                query: {
                    src_place_id: Joi.number().integer(), //起点地址编号
                    dest_post_code: Joi.string(), //终点城市邮编
                    user_level: Joi.number().integer(), //用户编号
                    user_id: Joi.number().integer(), //用户编号
                    sell_price_id: Joi.number().integer(), //指定销售价编号
                    sell_product_id: Joi.number().integer(), //销售产品编号
                    service_type_id: Joi.number().integer(), //快递类别编号
                    channel_id: Joi.number().integer() //渠道编号
                },
                output: {
                    200: {
                        body: Joi.array().items(sell_price_result)
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/orders',
        router()
        //提交订单
        .route({
            path: '/',
            method: 'post',
            handler: handlers.orders.postSelf(),
            validate: {
                query: {
                    assign_account_id: Joi.number().integer(), //用户指定的预报账号
                },
                type: ['form', 'json'],
                body: order,
                output: {
                    /*200: {
                        body: order_create_result
                    }*/
                }
            }
        })
        //批量提交订单
        .route({
            path: '/batch',
            method: 'post',
            handler: handlers.orders.batchPostSelf(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(order).min(1),
                output: {
                    /*200: {
                        body: Joi.array().items(
                            order_create_result,
                            error_info) //编号
                    }*/
                }
            }
        })
        //获取自身订单
        .route({
            path: '/self',
            method: 'get',
            handler: handlers.orders.getSelf(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(order_for_get, Joi.number().integer())
                    }
                }
            }
        })
        //获取自身订单
        .route({
            path: '/self/page/:size?/:page?',
            method: 'get',
            handler: handlers.orders.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(order_for_get, Joi.number().integer())
                    }
                }
            }
        })
        //获取自身订单(有条件,倒叙)
        .route({
            path: '/search/self/page',
            method: 'get',
		        handler: handlers.orders.getAllPageByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    operate_type: Joi.number().integer(), //业务类型 0递送，1存仓
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    tag_no: Joi.string(), //运输单号，用户单号
                    v_receiver_country_id:Joi.number().integer(), //终点国家编号
		                sell_product_id:Joi.number().integer(),		//销售产品
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json'],
				        output: {
                    200: {
                        body: Joi.array().items(order_for_get, Joi.number().integer())
                    }
                }
            }
        })
        //获取预报订单(有条件,倒叙)
        .route({
            path: '/desc/search/page',
            method: 'get',
		        handler: handlers.orders.getAllPageByDescSearch(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    operate_type: Joi.number().integer(), //业务类型 0递送，1存仓
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    tag_no: Joi.string(), //运输单号，用户单号
                    v_receiver_country_id:Joi.number().integer(), //终点国家编号
          					sell_product_id:Joi.number().integer(),		//销售产品
          					channel_id:Joi.number().integer(),		//渠道编号
          					service_type_id:Joi.number().integer(),//服务类别编号
                              v_receiver_postcode: Joi.string().allow(null), //接收的邮编号码
          					store_city_id:Joi.number().integer(),		//存仓城市编号
          					store_station_id:Joi.number().integer(),		//存仓站点编号
          					status: Joi.number().integer(), //状态
                },
                type: ['form', 'json'],
	              output: {
                    200: {
                        body: Joi.array().items(order_for_get, Joi.number().integer())
                    }
                }
            }
        })
	      //获取预报订单(有条件,正序)
        .route({
            path: '/search/page',
            method: 'get',
		        handler: handlers.orders.getAllPageBySearch(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    operate_type: Joi.number().integer(), //业务类型 0递送，1存仓
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    tag_no: Joi.string(), //运输单号，用户单号
                    v_receiver_country_id:Joi.number().integer(), //终点国家编号
          					sell_product_id:Joi.number().integer(),		//销售产品
          					channel_id:Joi.number().integer(),		//渠道编号
          					service_type_id:Joi.number().integer(),//服务类别编号
                              v_receiver_postcode: Joi.string().allow(null), //接收的邮编号码
          					store_city_id:Joi.number().integer(),		//存仓城市编号
          					store_station_id:Joi.number().integer(),		//存仓站点编号
          					status: Joi.number().integer(), //状态
                },
                type: ['form', 'json'],
	              output: {
                    200: {
                        body: Joi.array().items(order_for_get, Joi.number().integer())
                    }
                }
            }
        })
        //获取指定id订单
        .route({
            path: '/of/:id',
            method: 'get',
            handler: handlers.orders.getById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //预报编号
                },
                output: {
                    200: {
                        body: order_for_get
                    }
                }
            }
        })
        //修改订单
        .route({
            path: '/of/:id',
            method: ['put', 'patch'],
            handler: handlers.orders.modifyById(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //orders编号
                },
                body: order_for_change
            }
        })
        //.route({path: '/self/:id', method: 'get', handler: [verify, controllers.Orders.index_self]
        //获取自身指定订单
        .route({
            path: '/self/:id',
            method: 'get',
            handler: handlers.orders.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //预报单号
                },
                output: {
                    200: {
                        body: order_for_get
                    }
                }
            }
        })
        //获取自身自定单号订单
        .route({
            path: '/self/tag_no/:tag_no',
            method: 'get',
            handler: handlers.orders.getSelfByTagNoId(),
            validate: {
                params: {
                    tag_no: Joi.string().required() //运输单号，用户单号
                },
                output: {
                    200: {
                        body: order_for_get
                    }
                }
            }
        })
        //批量删除自身订单，参数直接放到地址栏上
        .route({
            path: '/self/datch/:ids',
            method: ['delete'],
            handler: handlers.orders.deleteBatchByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //orders表的id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
	       //修改自身订单
        .route({
            path: '/self/:id',
            method: ['put', 'patch'],
            handler: handlers.orders.modifySelfById(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //orders编号
                },
                body: order_for_change
            }
        })
        //预备订单
        .route({
            path: '/ready',
            method: 'get',
            handler: handlers.orders.readyOrder(),
            validate: {
                query: {
                    tag_no: Joi.string().required(), //单号
                    user_id: Joi.number().integer() //用户编号
                },
                output: {
                    200: {
                        body: order_for_ready
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/transports',
        router()
        //创建订单
        .route({
            path: '/',
            method: 'post',
            handler: handlers.transports.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: transport,
                output: {
                    200: {
                        body: transport_for_get
                    }
                }
            }
        })
        //批量创建订单
        .route({
            path: '/batch',
            method: 'post',
            handler: handlers.transports.createBatch(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(transport).min(1),
                output: {
		                /*
                    200: {
                        body: Joi.array().items(
                            transport_for_get,
                            error_info) //编号
                    }
                   */
                }
            }
        })
        //批量删除订单，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.transports.batchDeleteSelfByUrlIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //transport表的id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //批量删除订单
        .route({
            path: '/datch',
            method: ['delete'],
            handler: handlers.transports.batchDeleteSelfByIds(),
            validate: {
                type: ['form', 'json'],
                body: {
                    ids: Joi.array().items(Joi.number().integer().required()) //transport表的主键
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //批量修改订单
        .route({
            path: '/batch/id',
            method: ['put', 'patch'],
            handler: handlers.transports.batchModifyByIds(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(transport_for_change_more).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            transport_for_get,
                            error_info) //编号
                    }
                }
            }
        })
        //批量修改订单指定单号（有条件修改）
        .route({
            path: '/batch/tag_no',
            method: ['put', 'patch'],
            handler: handlers.transports.batchModifyByTagNo(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(transport_for_change_more).min(1), //根据tag_no修改
                output: {
                    200: {
                        body: Joi.array().items(
                            transport_for_get,
                            error_info) //编号
                    }
                }
            }
        })
        //根据预报单号快速录单
        .route({
            path: '/quick',
            method: 'post',
            handler: handlers.transports.quickPost(),
            validate: {
                type: ['form', 'json'],
                body: transport_for_quick,
                query: removeKeys(transport_for_quick, ['tag_no', 'in_weight', 'line_no']),
                output: {
                    200: {
                        body: transport_for_get
                    }
                }
            }
        })
        //获取指定订单
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.transports.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //运输编号
                },
                output: {
                    200: {
                        body: transport_for_get
                    }
                }
            }
        })
        //获取指定单号订单
        .route({
            path: '/tag_no/:tag_no',
            method: 'get',
            handler: handlers.transports.getSelfByTagNo(),
            validate: {
                params: {
                    tag_no: Joi.string().required() //运输单号，用户单号
                },
                output: {
                    200: {
                        body: transport_for_get
                        //                        body: Joi.array().items(transport_for_get)
                    }
                }
            }
        })
        //获取指定订单,包括流水号、转单号、运单号、参考号
        .route({
            path: '/no/:no',
            method: 'get',
            handler: handlers.transports.getCollectionByNo(),
            validate: {
                params: {
                    no: Joi.string().required() //运输单号，用户单号
                },
                output: {
                    200: {
                        body: transport_for_get
                        //                        body: Joi.array().items(transport_for_get)
                    }
                }
            }
        })
        //修改订单
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.transports.modifySelfById(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //运输编号
                },
                body: transport_for_change
            }
        })
        //指定订单进行发货
        .route({
            path: '/start/one',
            method: ['post'],
            handler: handlers.transports.startSelf(),
            validate: {
                type: ['form', 'json'],
                body: transport_for_start,
                query: removeKeys(transport_for_start, ['out_weight', 'tag_no']),
                output: {
                    200: {
                        body: transport_for_get
                    }
                }
            }
        })
        //批量进行发货
        .route({
            path: '/start/patch',
            method: ['post'],
            handler: handlers.transports.batchStart(),
            validate: {
                type: ['form', 'json'],
                body: transport_for_start,
                query: removeKeys(transport_for_start, ['out_weight', 'tag_no']),
                output: {
                    200: {
                        body: Joi.array().items(
                            transport_for_get,
                            error_info) //编号
                    }
                }
            }
        })
        //创建一票多件的总单
        .route({
            path: '/bind',
            method: 'post',
            handler: handlers.transports.createOneOfMulti(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(Joi.number().integer()), //需要合并的订单编号
                output: {
                    200: {
                        body: Joi.number().integer() //总单编号
                    }
                }
            }
        })
        //获取订单
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.transports.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    user_id: Joi.number().integer(),
                    carrier_id: Joi.number().integer(),
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
                    sell_product_id:Joi.number().integer(),		//销售产品
                    tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考
                    channel_id:Joi.number().integer(),		//用户指定的渠道编号
		                service_type_id:Joi.number().integer(),//用户指定的服务类别
		                real_line_id:Joi.number().integer(),		//真实的线路编号
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
            		    fetcher_id:Joi.number().integer(),		//取件人编号
            		    agent_id:Joi.number().integer(),		//经办人编号
            		    v_receive_status:Joi.number().integer(),		//收款状态	对客户
            		    v_pay_status:Joi.number().integer(),		//支付状态	对承运商的
            		    problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(transport_for_get, Joi.number().integer())
                    }
                }*/
            }
        })
        //获取订单 倒叙输出
        .route({
            path: '/desc/search/page',
            method: 'get',
            handler: handlers.transports.getAllPageDesc(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    user_id: Joi.number().integer(),
                    carrier_id: Joi.number().integer(),
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
                    sell_product_id:Joi.number().integer(),		//销售产品
                    tag_no: Joi.string().allow(null), //内单号
                    line_no:Joi.string().allow(null),		//转单号
            		    exchange_no:Joi.string().allow(null),	//参考号
            		    channel_id:Joi.number().integer(),		//用户指定的渠道编号
            		    service_type_id:Joi.number().integer(),//用户指定的服务类别
            		    real_line_id:Joi.number().integer(),		//真实的线路编号
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
            		    fetcher_id:Joi.number().integer(),		//取件人编号
            		    agent_id:Joi.number().integer(),		//经办人编号
            		    v_receive_status:Joi.number().integer(),		//收款状态	对客户
            		    v_pay_status:Joi.number().integer(),		//支付状态	对承运商的
            		    problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(transport_for_get, Joi.number().integer())
                    }
                }*/
            }
        })

        .middleware()
    )
    //问题类型表（problems） problem_for_create
    .use('/problems', router()
        //获得所有问题类型
        .route({
            path: '/',
            method: 'get',
            handler: handlers.problems.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(problem)
                    }
                }
            }
        })
        //获得指定问题类型
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.problems.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //问题类型编号
                },
                output: {
                    200: {
                        body: problem
                    }
                }
            }
        })
        //添加问题类型
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.problems.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: problem_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //问题类型编号,返回的结果
                    }
                }
            }
        })
        //删除问题类型
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.problems.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //问题类型编号
                }
            }
        })
        //修改问题类型
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.problems.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //问题类型编号
                },
                type: ['form', 'json'],
                body: problem_for_change
            }
        })
        .middleware()
    )
    .use(
        '/transport_problems',
        router()
        //获得所有问题件
        .route({
            path: '/',
            method: 'get',
            handler: handlers.transport_problems.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(transport_problem)
                    }
                }
            }
        })
        //分页获得所有问题件
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.transport_problems.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(1000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(transport_problem, Joi.number().integer())
                    }
                }
            }
        })
        //分页获得问题件 有条件正序
        .route({
            path: '/search/page',
            method: 'get',
	          handler: handlers.transport_problems.getAllPageByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(1000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
	                  id: Joi.number().integer(),
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    problem_id:Joi.number().integer(), //问题类型编号
            		    transport_id:Joi.number().integer(),		//票件id
            		    comment: Joi.string().allow(null), //备注
            		    status: Joi.number().integer(), //状态
                },
                output: {
                    200: {
                        body: Joi.array().items(transport_problem, Joi.number().integer())
                    }
                }
            }
        })
	       //分页获得问题件 有条件倒叙
        .route({
            path: '/desc/search/page',
            method: 'get',
            handler: handlers.transport_problems.getAllPageByConditionDesc(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(1000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
	                  id: Joi.number().integer(),
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    problem_id:Joi.number().integer(), //问题类型编号
            		    transport_id:Joi.number().integer(),		//票件id
            		    comment: Joi.string().allow(null), //备注
            		    status: Joi.number().integer(), //状态
                },
                output: {
                    200: {
                        body: Joi.array().items(transport_problem, Joi.number().integer())
                    }
                }
            }
        })
        //创建票件问题
        .route({
            path: '/',
            method: 'post',
            handler: handlers.transport_problems.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: transport_problem_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //问题
                    }
                }
            }
        })
        //修改票件问题
        .route({
            path: '/:id',
            method: 'put',
            handler: handlers.transport_problems.modifySelfById(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //问题编号
                },
                body: transport_problem_for_change,
            }
        })
        //删除票件问题
	       .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.transport_problems.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //问题编号
                }
            }
        })
	       //批量删除票件，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.transport_problems.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //票件问题编号
                }
            }
        })
        //查询一票件的问题
        .route({
            path: '/transports/:id',
            method: 'get',
            handler: handlers.transport_problems.getSelfByTransportId(),
            validate: {
                params: {
                    id: Joi.number().integer().required()
                },
                output: {
                    200: {
                        body: Joi.array().items(transport_problem)
                    }
                }
            }
        })
        //获取自身问题件
        .route({
            path: '/self/page',
            method: 'get',
            handler: handlers.transport_problems.getAllSelf(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    created_at: '$query.start_time!=undefined?{ $gte: $query.start_time}:undefined',
            		    $and: { created_at: '$query.end_time!=undefined?{ $lte: $query.end_time}:undefined' },
            		    problem_id: '$query.problem_id',
            		    transport_id: '$query.transport_id',
            		    comment: Joi.string().allow(null), //备注
            		    status: '$query.status',
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(transport_problem, Joi.number().integer())
                    }
                }
            }
        })
        //获取自身问题件,有条件倒叙
        .route({
            path: '/desc/self/page',
            method: 'get',
            handler: handlers.transport_problems.getAllPageSelfDesc(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(),
                    created_at: '$query.start_time!=undefined?{ $gte: $query.start_time}:undefined',
            		    $and: { created_at: '$query.end_time!=undefined?{ $lte: $query.end_time}:undefined' },
            		    problem_id: '$query.problem_id',
            		    transport_id: '$query.transport_id',
            		    comment: Joi.string().allow(null), //备注
            		    status: '$query.status',
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(transport_problem, Joi.number().integer())
                    }
                }
            }
        })

        //获取自身指定问题件
        .route({
            path: '/self/:id',
            method: 'get',
            handler: handlers.transport_problems.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //问题编号
                },
                output: {
                    200: {
                        body: transport_problem
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/alogin',
        router()
        //用户登录
        .route({
            path: '/',
            method: 'post',
            handler: handlers.users.staffLogin(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    password: Joi.string().min(6).max(50).required() //密码
                },
                output: {
                    200: {
                        body: {
                            token: Joi.string() //验证码
                        }
                    }
                }
            }
        })
        .middleware()
    )
    //管理后台相关接口，需要验证管理员权限
    .use(
        //这里是直接外面加了一个管理的验证，其实可以在每张表中加一个admin-verify
        '/admin', admin_verify,
        router()
        .post('/test', direct)
        //登出
        .post('/logout', handlers.admin.logout())
        //修改密码
        .route({
            path: '/change_password',
            method: 'post',
            handler: handlers.admin.ChangePassword(),
            validate: {
                type: ['form', 'json'],
                body: {
                    username: Joi.string().min(3).max(20).required(), //用户名
                    old_password: Joi.string().min(6).max(50).required(), //老密码
                    new_password: Joi.string().min(6).max(50).required() //新密码
                }
            }
        })
        //员工相关接口
        .use('/staffs', router()
            //获得员工自身帐号信息
            .route({
                path: '/self/info',
                method: 'get',
                handler: handlers.staffs.getStaffSelfInfo(),
                validate: {
                    output: {
                        200: {
                            body: staff
                        }
                    }
                }
            })
            //修改员工自身帐号信息
            .route({
                path: '/self/info',
                method: ['put', 'patch'],
                handler: handlers.staffs.modifySelf(),
                validate: {
                    type: ['form', 'json'],
                    body: Joi.object({
                        name: Joi.string().min(1).max(50), //员工名称
                        email: Joi.string().max(255).email() //员工邮箱
                    }).min(1)
                }
            })
            //获得所有员工信息
            .route({
                path: '/',
                method: 'get',
                handler: handlers.staffs.getStaffAll(),
                validate: {
                    output: {
                        200: {
                            body: Joi.array().items(staff)
                        }
                    }
                }
            })
            //获得指定员工信息
            .route({
                path: '/:id',
                method: 'get',
                handler: handlers.staffs.getStaffById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //员工编号
                    },
                    output: {
                        200: {
                            body: staff
                        }
                    }
                }
            })
            //添加员工信息
            .route({
                path: '/',
                method: ['post'],
                handler: handlers.staffs.addStaff(),
                validate: {
                    type: ['form', 'json'],
                    body: staff_for_change,
                    output: {
                        200: {
                            body: Joi.number().integer() //员工编号
                        }
                    }
                }
            })
            //删除员工信息
            .route({
                path: '/:id',
                method: ['delete'],
                handler: handlers.staffs.deleteSelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //员工编号
                    }
                }
            })
            //修改员工信息
            .route({
                path: '/:id',
                method: ['put', 'patch'],
                handler: handlers.staffs.modifySelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //员工编号
                    },
                    type: ['form', 'json'],
                    body: staff_for_change
                }
            })
            .middleware()
        )
        //部门类型接口，后面会去掉，这个其实是不能修改的，只能获取
        .use('/department_types', router()
            //获得所有部门类型信息
            .route({
                path: '/',
                method: 'get',
                handler: handlers.department_types.getAll(),
                validate: {
                    output: {
                        200: {
                            body: Joi.array().items(department_type)
                        }
                    }
                }
            })
            //获得指定部门类型信息
            .route({
                path: '/:id',
                method: 'get',
                handler: handlers.department_types.getSelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门类型编号
                    },
                    output: {
                        200: {
                            body: department_type
                        }
                    }
                }
            })
            //添加部门类型信息
            .route({
                path: '/',
                method: ['post'],
                handler: handlers.department_types.addSelf(),
                validate: {
                    type: ['form', 'json'],
                    body: department_type_for_change,
                    output: {
                        200: {
                            body: Joi.number().integer() //部门类型编号
                        }
                    }
                }
            })
            //删除部门类型信息
            .route({
                path: '/:id',
                method: ['delete'],
                handler: handlers.department_types.deleteSelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门类型编号
                    }
                }
            })
            //修改部门信息
            .route({
                path: '/:id',
                method: ['put', 'patch'],
                handler: handlers.department_types.modifySelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门类型编号
                    },
                    type: ['form', 'json'],
                    body: department_type_for_change
                }
            })
            .middleware()
        )
        //部门相关接口
        .use('/departments', router()
            //获得所有部门信息
            .route({
                path: '/',
                method: 'get',
                handler: handlers.departments.getAll(),
                validate: {
                    output: {
                        200: {
                            body: Joi.array().items(department)
                        }
                    }
                }
            })
            //获得指定部门信息
            .route({
                path: '/:id',
                method: 'get',
                handler: handlers.departments.getSelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门编号
                    },
                    output: {
                        200: {
                            body: department
                        }
                    }
                }
            })
            //添加部门信息
            .route({
                path: '/',
                method: ['post'],
                handler: handlers.departments.addSelf(),
                validate: {
                    type: ['form', 'json'],
                    body: department_for_change,
                    output: {
                        200: {
                            body: Joi.number().integer() //部门编号
                        }
                    }
                }
            })
            //删除部门信息
            .route({
                path: '/:id',
                method: ['delete'],
                handler: handlers.departments.deleteSelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门编号
                    }
                }
            })
            //修改部门信息
            .route({
                path: '/:id',
                method: ['put', 'patch'],
                handler: handlers.departments.modifySelfById(),
                validate: {
                    params: {
                        id: Joi.number().integer().required() //部门编号
                    },
                    type: ['form', 'json'],
                    body: department_for_change
                }
            })
            .middleware()
        )
        .middleware()
    )
    //用户操作权限信息表[actions表]
    .use('/actions', router()
        //获得所有操作信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.actions.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(action)
                    }
                }
            }
        })
        //获得指定操作信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.actions.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号
                },
                output: {
                    200: {
                        body: action
                    }
                }
            }
        })
        //添加操作信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.actions.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: action_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //操作编号,返回的结果
                    }
                }
            }
        })
        //删除操作信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.actions.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号
                }
            }
        })
        //修改操作信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.actions.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号
                },
                type: ['form', 'json'],
                body: action_for_create
            }
        })
        .middleware()
    )
    //角色相关的接口
    .use(
        '/actors',
        router()
        //展示所有的用户角色(分页展示的话只是出现在指定对象上面的)
        .route({
            path: '/',
            method: 'get',
            handler: handlers.actors.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(actor)
                    }
                }
            }
        })
        //查询指定用户角色
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.actors.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //邮编，从左匹配
                },
                output: {
                    200: {
                        body: actor
                    }
                }
            }
        })
        //添加角色信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.actors.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: actor_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //角色编号
                    }
                }
            }
        })
        //获得指定角色的下的操作
        .route({
            path: '/actor_actions/:id',
            method: 'get',
            handler: handlers.actors.getActionById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色编号
                },
                output: {
                    200: {
                        body: Joi.array().items(actor_action)
                    }
                }
            }
        })
        //批量创建指定角色的多个操作
        .route({
            path: '/batch/:id',
            method: 'post',
            handler: handlers.actors.batchCreateActionById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色的编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(actor_action_for_add).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
        //批量创建删除指定角色的多个操作 角色操作日志表
        .route({
            path: '/batch_log/:id',
            method: 'put',
            handler: handlers.actors.batchCreateDeleteActionById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色的编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(actor_action_logs_for_add).min(1),
                /*output: {
                    200: {
                      body: Joi.array().items(Joi.number().integer())//编号
                    }
                      }*/
            }
        })
        //批量删除指定角色的多个操作
        .route({
            path: '/datch/actor/:id/actions/:ids',
            method: ['delete'],
            handler: handlers.actors.batchDeleteActionById(),
            validate: {
                params: {
                    id: Joi.number().integer().required(), //角色操作表的actor_id
                    ids: Joi.array().items(Joi.number().integer().required()) //角色操作表的action_id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //删除角色信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.actors.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色编号
                }
            }
        })
        //修改角色信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.actors.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色编号
                },
                type: ['form', 'json'],
                body: actor_for_create
            }
        })
        .middleware()
    )
    //角色的相关操作
    .use(
        '/actor_actions',
        router()
        //获得所有角色的操作信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.actor_actions.getAll(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(1000).default(1000), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(actor_action, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有角色操作信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.actor_actions.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(1000).default(1000), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(actor_action, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定角色的下的操作
        .route({
            path: '/actor/:id',
            method: 'get',
            handler: handlers.actor_actions.getActionByActorId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色编号
                },
                output: {
                    200: {
                        body: Joi.array().items(actor_action)
                    }
                }
            }
        })
        //获得指定角色操作
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.actor_actions.getActionById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //规则表中编号
                },
                output: {
                    200: {
                        body: actor_action
                    }
                }
            }
        })
        //批量删除指定角色编号
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.actor_actions.deleteSelfById(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //角色操作编号列表
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
        //创建指定的角色下的操作
        .route({
            path: '/actor/:id',
            method: ['post'],
            handler: handlers.actor_actions.createActionByActorId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色编号
                },
                type: ['form', 'json'],
                body: actor_action_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //角色操作编号
                    }
                }
            }
        })
        //批量创建指定角色的多个操作
        .route({
            path: '/batch/actor/:id',
            method: 'post',
            handler: handlers.actor_actions.batchCreateActionByActorId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //角色的编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(actor_action_for_create).min(1),
                /*output: {
                  200: {
                    body: Joi.array().items(Joi.number().integer())//编号
                  }
                    }*/
            }
        })
        //删除指定角色操作
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.actor_actions.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                }
            }
        })
        //修改指定的角色操作
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.actor_actions.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                type: ['form', 'json'],
                body: actor_action_for_create
            }
        })
        .middleware()
    )
    //用户商务信息表
    .use(
        '/user_business_infos',
        router()
       //获得所有用户业务信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.user_business_infos.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(user_business_info, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有用户业务信息
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.user_business_infos.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(user_business_info, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有用户业务信息
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.user_business_infos.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(255).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(user_business_info, Joi.number().integer())
                    }
                }
            }
        })
        //获得用户的业务信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.user_business_infos.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().allow() //busines_id
                },
                output: {
                    200: {
                        body: user_business_info
                    }
                }
            }
        })
        .route({path: '/:id', method: 'get', handler: handlers.user_business_infos.getSelfById1(),
         //获得指定的业务信息表
          ,validate: {
            params: {
        	id: Joi.number().integer().required()//user_id
            },
          	output: {
        		200: {
          		body: user_business_info
       		 }
            }}
        })

        //获得指定用户下的用户商务信息
        .route({
            path: '/user/:id',
            method: 'get',
            handler: handlers.user_business_infos.getSelfByUserId(),
                // attributes: [],则返回的结果为空，如果不写，就所填的信息都返回出来。
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户编号（就是从用户表中的id找到对应的business_id 然后在找user_business_infos中的user_id,因为他和business_id是一一对应上的）
                },
                output: {
                    200: {
                        body: Joi.array().items(user_business_info)
                    }
                }
            }
        })

        //添加用户下的业务信息
        .route({
            path: '/:id',
            method: ['post'],
            handler: handlers.user_business_infos.addSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //
                },
                type: ['form', 'json'],
                body: user_business_info_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //用户商务信息表的主键，当然这个也是从users表中来的
                    }
                }
            }
        })
        //删除用户业务信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.user_business_infos.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户商务信息表的主键(user_id)
                }
            }
        })
        //修改用户业务信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.user_business_infos.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户商务信息表的主键(user_id)
                },
                type: ['form', 'json'],
                body: user_business_info_for_change
            }
        })
        .middleware()
    )
    //用户账户金额【user_accounts】
    .use(
        '/user_accounts',
        router()
        //获得所有用户的账户金额（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.user_accounts.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(user_account)
                    }
                }
            }
        })
        //获得所有用户的账户金额（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.user_accounts.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(user_account, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定的用户的账户金额（单个）
        .route({
            path: 'user/:id',
            method: 'get',
            handler: handlers.user_accounts.getByUserId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户的账户金额表的id
                },
                output: {
                    200: {
                        body: user_account
                    }
                }
            }
        })
        //获得指定条件用户的账户金额表（全部）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.user_accounts.getAllBySearch(),
            validate: {
                query: {
                    user_id: Joi.number().integer(), //用户编号
                    min_balance: Joi.number().integer(), //最小金额
                    max_balance: Joi.number().integer() //最大金额
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(user_account)
                    }
                }
            }
        })
        //获得指定条件用户的账户金额表（分页）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.user_accounts.getAllPageBySearch(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    user_id: Joi.number().integer(), //用户编号
                    min_balance: Joi.number().integer(), //最小金额
                    max_balance: Joi.number().integer() //最大金额
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(user_account, Joi.number().integer())
                    }
                }
            }
        })

        //创建某一条用户的账户金额
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.user_accounts.createByUser(),
            validate: {
                type: ['form', 'json'],
                body: user_account_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
	       //添加指定用户下的金额信息
        .route({
            path: 'user/:id',
            method: ['post'],
            handler: handlers.user_accounts.createByUserId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户id
                },
                type: ['form', 'json'],
                body: user_account_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //
                    }
                }
            }
        })
        //修改账户金额表
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.user_accounts.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户的账户金额表id
                },
                type: ['form', 'json'],
                body: user_account_for_change
            }
        })
        //删除用户金额(单个)
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.user_accounts.deleteByUserId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //用户的账户金额表的主键
                }
            }
        })
        //批量用户金额，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.user_accounts.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //用户的账户金额表的id
                }
            }
        })

        .middleware()
    )
    //给员工分配角色 权限分配的表（分为两步，给员工什么角色，有效范围是什么）[staff_actors员工拥有的角色表]
    .use('/staff_actors', router()
        //获得所有角色信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.staff_actors.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(staff_actor)
                    }
                }
            }
        })
        //获得指定id员工角色表信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.staff_actors.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工拥有的角色表 的主键
                },
                output: {
                    200: {
                        body: staff_actor
                    }
                }
            }
        })
        //获得指定员工下的员工角色表信息
        .route({
            path: '/staff/:id',
            method: 'get',
            handler: handlers.staff_actors.getByStaffId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工编号
                },
                output: {
                    200: {
                        body: Joi.array().items(staff_actor)
                    }
                }
            }
        })
        //给指定的员工添加角色和有效范围
        .route({
            path: '/staff/:id',
            method: ['post'],
            handler: handlers.staff_actors.addActorInfoByStaffId(),
            validate: {
                type: ['form', 'json'],
                body: staff_actor_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的主键id,返回的结果
                    }
                }
            }
        })
        //删除员工角色表某条数据
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.staff_actors.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号 员工角色表的主键
                }
            }
        })
        //修改员工角色表某条数据
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.staff_actors.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号 员工角色表的主键
                },
                type: ['form', 'json'],
                body: staff_actor_for_create
            }
        })
        .middleware()
    )
    //员工所属部门表相关操作
    .use('/staff_departments', router()
        //获得所有员工部门信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.staff_departments.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(staff_department)
                    }
                }
            }
        })
        //获得指定id员工部门表信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.staff_departments.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工部门表 的主键
                },
                output: {
                    200: {
                        body: staff_department
                    }
                }
            }
        })
        //获得指定部门下的员工信息
        .route({
            path: '/department/:id',
            method: 'get',
            handler: handlers.staff_departments.getSelfByDepartmentId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //部门编号
                },
                output: {
                    200: {
                        body: Joi.array().items(staff_department)
                    }
                }
            }
        })
        //添加员工部门信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.staff_departments.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: staff_department,
                output: {
                    200: {
                        body: Joi.number().integer() //操作编号,返回的结果
                    }
                }
            }
        })
        //给指定的员工添加部门
        .route({
            path: '/staff/:id',
            method: ['post'],
            handler: handlers.staff_departments.addByStaffId(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //id为员工编号
                },
                body: staff_department_for_add
            }
        })
        //给指定部门分配员工
        .route({
            path: '/departments/:id',
            method: ['post'],
            handler: handlers.staff_departments.addStaffByDepartmentId(),
            validate: {
                type: ['form', 'json'],
                params: {
                    id: Joi.number().integer().required() //id为部门编号
                },
                body: staff_department
            }
        })
        //删除员工部门表某条数据
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.staff_departments.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号 员工部门表的主键
                }
            }
        })
        //修改员工部门表某条数据
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.staff_departments.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //操作编号 员工部门表的主键
                },
                type: ['form', 'json'],
                body: staff_department_for_create
            }
        })
        .middleware()
    )
    //员工自身信息的相关接口
    .use(
        '/staff_infos',
        router()
        //创建员工自身信息
        .route({
            path: '/self/info',
            method: ['post'],
            handler: handlers.staff_infos.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: staff_info_for_create,
                output: {
      					200: {
        						body: Joi.number().integer() //操作编号,返回的结果
        					}
        				}
            }
        })
        //获得员工自身信息
        .route({
            path: '/self/info',
            method: 'get',
            handler: handlers.staff_infos.getSelf(),
            validate: {
                output: {
                    200: {
                        body: staff_info_with_time
                    }
                }
            }
        })
        //修改员工自身信息
        .route({
            path: '/self/info',
            method: ['put', 'patch'],
            handler: handlers.staff_infos.modifySelf(),
            validate: {
                type: ['form', 'json'],
                body: staff_info_for_change
            }
        })
        //获得指定id员工信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.staff_infos.getById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工账号id
                },
                output: {
                    200: {
                        body: staff_info_for_get
                    }
                }
            }
        })
        //添加员工详细信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.staff_infos.addSelf(),
            validate: {
                type: ['form', 'json'],
                body: staff_info,
                output: {
                    200: {
                        body: Joi.number().integer() //操作编号,返回的结果
                    }
                }
            }
        })
        //删除某条员工信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.staff_infos.deleteById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工信息编号
                }
            }
        })
        //修改指定id员工信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.staff_infos.modifyById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //员工信息编号id
                },
                type: ['form', 'json'],
                body: staff_info_for_change
            }
        })
        .middleware()
    )
    //配置信息
    .use(
        '/system_configs',
        router()
        //获取配置
        .route({
            path: '/:key/:related_id?',
            method: 'get',
            handler: handlers.system_configs.getConfigByKey(),
            validate: {
                params: {
                    key: Joi.string().required(), //配置名称
                    related_id: Joi.number().integer() //关联编号
                },
                query: {
                    extend_id: Joi.number().integer() //扩展编号
                },
                outpput: {
                    200: {
                        body: system_config
                    }
                }
            }
        })
        //创建配置信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.system_configs.addConfig(),
            validate: {
                type: ['form', 'json'],
                body: system_config_for_create
            }
        })
        //修改配置信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.system_configs.modifyById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //配置信息 配置表的主键
                },
                type: ['form', 'json'],
                body: system_config_for_create
            }
        })
        .middleware()
    )
    //模版配置接口
    .use(
        '/templates',
        router()
        //创建模版
        .route({
            path: '/:type_id/:name?',
            method: 'post',
            handler: handlers.templates.addTmpById(),
            validate: {
                params: {
                    type_id: Joi.number().integer(), //类型编号
                    name: Joi.string().max(50) //模版名称
                },
                type: ['multipart'],
                output: {
                    200: {
                        body: Joi.number().integer() //模版编号
                    }
                }
            }
        })
        //修改模版
        .route({
            path: '/:id',
            method: 'put',
            handler: handlers.templates.modifyTmpById(),
            validate: {
                params: {
                    id: Joi.number().integer() //模版编号
                },
                type: ['multipart'],
                output: {
                    200: {
                        body: Joi.number().integer() //模版编号
                    }
                }
            }
        })
        //下载所有模版(列表)
        .route({
            path: '/',
            method: 'get',
            handler: handlers.templates.dowloadTmp(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(template)
                    }
                }
            }
        })
        //获得所有模版(列表)
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.templates.getAllTmp(),
            validate: {
	          query: {
                    type_id: Joi.number().integer(), //类型编号
                    start_time: Joi.date(),
                    end_time: Joi.date()
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(template)
                    }
                }
            }
        })
        //下载模版
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.templates.dowloadTmpById(),
            validate: {
                params: {
                    id: Joi.number().integer() //模版编号
                }
            }
        })
        //用户下载渲染后的内容
        .route({
            path: '/sell_product/self/:no',
            method: 'get',
            handler: handlers.templates.dowloadSelfTmpByNo(),
            validate: {
                params: {
                    no: Joi.string() //单号，同时支持内单、转单、参考号、编号
                },
                query: {
                    template_id:Joi.number().integer().allow(null), //模板编号
                    id: Joi.number().integer().allow(null), //编号
                    tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null) //参考号
                }
                /*type: ['form'],
                output: {
                  200: {
                    body: Joi.number().integer()//模版编号
                  }
                }*/
            }
        })
        //下载渲染后的内容
        .route({
            path: '/sell_product/:no',
            method: 'get',
            handler: handlers.templates.dowloadTmpByNo(),
            validate: {
                params: {
                    no: Joi.string() //单号，同时支持内单、转单、参考号、编号
                },
                query: {
	                  template_id:Joi.number().integer().allow(null), //模板编号
                    id: Joi.number().integer().allow(null), //编号
                    tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null) //参考号
                }
                /*type: ['form'],
                output: {
                  200: {
                    body: Joi.number().integer()//模版编号
                  }
                }*/
            }
        })
        //批量下载渲染后的内容
        .route({
            path: '/sell_product/batch/:nos',
            method: 'get',
            handler: handlers.templates.batchDowloadByNos(),
            validate: {
                params: {
                    nos: Joi.array().items(Joi.string().required()) //单号列表
                },
                query: {
                    sell_product_id: Joi.number().integer().allow(null), //销售产品编号
                },
                /*output: {
                  200: {
                    body: Joi.number().integer()//模版编号
                  }
                }*/
            }
        })
        //批量下载渲染后的内容
        .route({
            path: '/sell_product/self/batch/:nos',
            method: 'get',
            handler: handlers.templates.batchDowloadSelfByNos(),
            validate: {
                params: {
                    nos: Joi.array().items(Joi.string().required()) //单号列表
                },
                query: {
                    sell_product_id: Joi.number().integer().allow(null), //销售产品编号
                },
                /*output: {
                  200: {
                    body: Joi.number().integer()//模版编号
                  }
                }*/
            }
        })
        .middleware()
    )
    .use(
        '/traces',
        router()
        //获取跟踪记录
        .route({
            path: '/:no',
            method: 'get',
            handler: handlers.traces.getSelfByNo(),
            validate: {
                params: {
                    no: Joi.string() //单号，同时支持内单、转单、参考号、编号
                },
                query: {
                    id: Joi.number().integer().allow(null), //编号
                    tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null) //参考号
                }
            }
        })
        //批量获取跟踪记录
        .route({
            path: '/batch/:nos',
            method: 'get',
            handler: handlers.traces.batchGetSelfByNos(),
            validate: {
                params: {
                    nos: Joi.array().items(Joi.string().required()) //跟踪单号
                },
            }
        })
        //根据条件获取跟踪记录
        .route({
            path: '/select',
            method: 'get',
            handler: handlers.traces.getAllByCondition(),
            validate: {
                query: {
                    id: Joi.number().integer(), //订单编号
                    user_id: Joi.number().integer(),		//客户编号
                    carrier_id: Joi.number().integer(),		//承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
					s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
					tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考号
                    sell_product_id:Joi.number().integer(),		//销售产品
					channel_id:Joi.number().integer(),		//用户指定的渠道编号
					service_type_id:Joi.number().integer(),//用户指定的服务类别
					real_line_id:Joi.number().integer(),		//真实的线路编号
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
					fetcher_id:Joi.number().integer(),		//取件人编号
					agent_id:Joi.number().integer(),		//经办人编号
					v_receive_status:Joi.number().integer(),		//收款状态	对客户
					v_pay_status:Joi.number().integer(),		//支付状态	对承运商的
					problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json']
            }
        })
        //根据条件获取跟踪记录,正序分页
		.route({
            path: '/select/page',
            method: 'get',
            handler: handlers.traces.getAllPageByCondition(),
            validate: {
                query: {
					size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(), //订单编号
                    user_id: Joi.number().integer(),		//客户编号
                    carrier_id: Joi.number().integer(),		//承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
					s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
					tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考号
                    sell_product_id:Joi.number().integer(),		//销售产品
					channel_id:Joi.number().integer(),		//用户指定的渠道编号
					service_type_id:Joi.number().integer(),//用户指定的服务类别
					real_line_id:Joi.number().integer(),		//真实的线路编号
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
					fetcher_id:Joi.number().integer(),		//取件人编号
					agent_id:Joi.number().integer(),		//经办人编号
					v_receive_status:Joi.number().integer(),		//收款状态	对客户
					v_pay_status:Joi.number().integer(),		//支付状态	对承运商的
					problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json']
            }
        })
		//根据条件获取跟踪记录,倒序分页
		.route({
            path: '/desc/select/page',
            method: 'get',
            handler: handlers.traces.getAllPageDescByCondition(),
            validate: {
                query: {
					size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(), //订单编号
                    user_id: Joi.number().integer(),		//客户编号
                    carrier_id: Joi.number().integer(),		//承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
					s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
					tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考号
                    sell_product_id:Joi.number().integer(),		//销售产品
					channel_id:Joi.number().integer(),		//用户指定的渠道编号
					service_type_id:Joi.number().integer(),//用户指定的服务类别
					real_line_id:Joi.number().integer(),		//真实的线路编号
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
					fetcher_id:Joi.number().integer(),		//取件人编号
					agent_id:Joi.number().integer(),		//经办人编号
					v_receive_status:Joi.number().integer(),		//收款状态	对客户
					v_pay_status:Joi.number().integer(),		//支付状态	对承运商的
					problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json']
            }
        })
        //根据条件获取自身的跟踪记录,正序分页
		.route({
            path: '/self/select/page',
            method: 'get',
            handler: handlers.traces.getSelfPageByCondition(),
            validate: {
                query: {
					size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(), //订单编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
					s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
					tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考号
                    sell_product_id:Joi.number().integer(),		//销售产品
					channel_id:Joi.number().integer(),		//用户指定的渠道编号
					service_type_id:Joi.number().integer(),//用户指定的服务类别
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
					problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json']
            }
        })
		//根据条件获取自身跟踪记录,倒序分页
		.route({
            path: '/self/desc/select/page',
            method: 'get',
            handler: handlers.traces.getSelfPageDescByCondition(),
            validate: {
                query: {
					size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    id: Joi.number().integer(), //订单编号
                    user_id: Joi.number().integer(),		//客户编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
					s_start_time: Joi.date(), //业务开始时间
                    s_end_time: Joi.date(), //业务结束时间
					tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null),	//参考号
                    sell_product_id:Joi.number().integer(),		//销售产品
					channel_id:Joi.number().integer(),		//用户指定的渠道编号
					service_type_id:Joi.number().integer(),//用户指定的服务类别
                    v_receiver_country_id:Joi.number().integer(),		//接收国家编号
					problem_status:Joi.number().integer(),		//是否有问题
                    status: Joi.number().integer(), //状态
                },
                type: ['form', 'json']
            }
        })
        //倒叙获取追踪信息
	 .route({
            path: 'desc/:no',
            method: 'get',
            handler: handlers.traces.getTraceDescByNo(),
            validate: {
                params: {
                    no: Joi.string() //单号，同时支持内单、转单、参考号、编号
                },
                query: {
                    id: Joi.number().integer().allow(null), //编号
                    tag_no: Joi.string().allow(null), //内单
                    line_no: Joi.string().allow(null), //转单
                    exchange_no: Joi.string().allow(null) //参考号
                }
            }
        })
        //创建指定订单编号的多条跟踪信息
        .route({
            path: '/batch/id/:transport_id',
            method: 'post',
            handler: handlers.traces.addTraceByTransportId(),
            validate: {
                params: {
                    transport_id: Joi.number().integer().required() //订单的编号
                },
                type: ['form', 'json'],
                body: Joi.array().items(trace_for_create_of).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
	       //创建指定单号的多条跟踪信息(????有点问题)
        .route({
            path: 'batch/tag_no/:transport_id/:trace_no',
            method: 'post',
            handler: handlers.traces.batchAddTraceByTransportIdAndTranceNo(),
            validate: {
                params: {
                    transport_id: Joi.number().integer().required(), //订单的编号
		    trace_no: Joi.number().integer().required() //跟踪的单号
                },
                type: ['form', 'json'],
                body: Joi.array().items(trace_for_create_of2).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })
	       //批量创建跟踪信息
        .route({
            path: '/batch',
            method: 'post',
            handler: handlers.traces.batchAddTrace(),
            validate: {
                type: ['form', 'json'],
                body: Joi.array().items(trace_for_create).min(1),
                output: {
                    200: {
                        body: Joi.array().items(
                            Joi.number().integer(),
                            error_info) //编号
                    }
                }
            }
        })

	       //修改跟踪信息(单个)
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.traces.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //跟踪信息表编号
                },
                type: ['form', 'json'],
                body: trace_for_change
            }
        })
        //批量删除追踪表，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.traces.batchDeleteTraceByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //traces表的id
                },
                output: {
                    200: {
                        body: Joi.number().integer()
                    }
                }
            }
        })
	       //获得指定条件追踪表（全部倒叙）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.traces.getTraceAllDescByCondition(),
            validate: {
                query: {
                    transport_id: Joi.number().integer(), //订单编号
					trace_type_id: Joi.number().integer(), //跟踪的网络类型编号
					happened_start_time: Joi.date(), //发生开始时间
                    happened_end_time: Joi.date(), //发生结束时间
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    trace_no: Joi.string(), //跟踪的单号
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(trace, Joi.number().integer())
                    }
                }
            }
        })
	       //获得指定条件条件追踪表（分页倒叙）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.traces.getTracePageDescByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    transport_id: Joi.number().integer(), //订单编号
					trace_type_id: Joi.number().integer(), //跟踪的网络类型编号
					happened_start_time: Joi.date(), //发生开始时间
                    happened_end_time: Joi.date(), //发生结束时间
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    trace_no: Joi.string(), //跟踪的单号
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(trace, Joi.number().integer())
                    }
                }
            }
        })
        .middleware()
    )

    //收款账单表【collection_bills】
    .use(
        '/collection_bills',
        router()
        //获得所有收款账单（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.collection_bills.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(collection_bill)
                    }
                }
            }
        })
        //获得所有收款账单（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.collection_bills.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(collection_bill, Joi.number().integer())
                    }
                }
            }
        })
        //获得所有的收款账单（分页）
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.collection_bills.getPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(collection_bill, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定的收款账单表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.collection_bills.getById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款账单表的id
                },
                output: {
                    200: {
                        body: collection_bill
                    }
                }
            }
        })
        //获得指定条件收款账单表（全部倒叙）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.collection_bills.getAllDescByCondition(),
            validate: {
                query: {
                    user_id: Joi.number().integer(), //用户编号
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(collection_bill, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定条件收款账单表（分页倒叙）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.collection_bills.getAllPageDescByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    user_id: Joi.number().integer(), //客户编号
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(collection_bill, Joi.number().integer())
                    }
                }
            }
        })
        //创建指定的客户收款账单
        .route({
            path: '/user/:id',
            method: ['post'],
            handler: handlers.collection_bills.createBillByUserId(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //客户的id
                },
                type: ['form', 'json'],
                body: collection_bill_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //创建收款账单
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.collection_bills.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: collection_bill_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //修改收款账单表
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.collection_bills.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款账单表id
                },
                type: ['form', 'json'],
                body: collection_bill_for_update
            }
        })
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.collection_bills.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款账单表的主键
                }
            }
        })
        //批量删除账单，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.collection_bills.batchDeleteByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //收款账单表表的id
                }
            }
        })
        .middleware()
    )
    //收款明细表【collection_records】
    .use(
        '/collection_records',
        router()
        //获得所有收款明细（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.collection_records.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(collection_record)
                    }
                }
            }
        })
        //获得所有收款明细（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.collection_records.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                /*output: {
                    200: {
                        body: Joi.array().items(collection_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //获得所有的收款明细（分页）
        .route({
            path: '/page/:size?/:page?',
            method: 'get',
            handler: handlers.collection_records.getAllPage(),
            validate: {
                params: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                /*output: {
                    200: {
                        body: Joi.array().items(collection_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //获得指定的收款明细（单个）
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.collection_records.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款明细表的id
                },
                output: {
                    200: {
                        body: collection_record
                    }
                }
            }
        })
        //获得指定条件收款明细表（全部）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.collection_records.getAllByCondition(),
            validate: {
                query: {
                    user_id: Joi.number().integer(), //用户编号
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(collection_record)
                    }
                }*/
            }
        })
        //获得指定条件收款明细表（分页）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.collection_records.getPageByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    user_id: Joi.number().integer(), //客户编号
                    start_time: Joi.date(),
                    end_time: Joi.date(),
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(collection_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //创建某一条收款明细
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.collection_records.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: collection_record_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //修改收款明细表
        /*
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: [admin_verify, controllers.Generals.update('collection_records')],
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款明细表id
                },
                type: ['form', 'json'],
                body: collection_record_for_update
            }
        })*/
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.collection_records.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //收款明细表的主键
                }
            }
        })
        //批量删除明细，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.collection_records.batchDeleteByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //收款明细表表的id
                }
            }
        })
        .middleware()
    )
    //收款明细表日志表【collection_records_logs】
    .use(
        '/collection_records_logs',
        router()
        //创建某一条收款明细日志表
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.collection_records_logs.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: collection_record_log_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        .middleware()
    )
    //付款明细表【payoff_records】【接口都是按时间进行倒叙输出】
    .use(
        '/payoff_records',
        router()
        //获得所有付款明细（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.payoff_records.getAll(),
            validate: {
                /*output: {
                    200: {
                        body: Joi.array().items(payoff_record)
                    }
                }*/
            }
        })
        //获得所有付款明细（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.payoff_records.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                /*output: {
                    200: {
                        body: Joi.array().items(payoff_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //获得指定的付款明细（单个）
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.payoff_records.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款明细表的id
                },
                /*output: {
                    200: {
                        body: payoff_record
                    }
                }*/
            }
        })
        //获得指定条件付款明细表（全部）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.payoff_records.getAllByCondition(),
            validate: {
                query: {
                    carrier_id: Joi.number().integer(), //承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(payoff_record)
                    }
                }*/
            }
        })
        //获得指定条件付款明细表（分页）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.payoff_records.getAllPageByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    carrier_id: Joi.number().integer(), //承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(payoff_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //创建某一条付款明细
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.payoff_records.createPayoffRecord(),
            validate: {
                type: ['form', 'json'],
                body: payoff_record_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //修改付款账单表
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.payoff_records.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款明细表id
                },
                type: ['form', 'json'],
                body: payoff_record_for_update
            }
        })
        //删除收款明细(单个)
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.payoff_records.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款明细表的主键
                }
            }
        })
        //批量删除明细，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.payoff_records.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //付款明细表的id
                }
            }
        })
        .middleware()
    )
    //付款账单表【payoff_bills】【接口都是按时间进行倒叙输出】
    .use(
        '/payoff_bills',
        router()
        //获得所有收款账单（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.payoff_bills.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(payoff_bill)
                    }
                }
            }
        })
        //获得所有付款账单（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.payoff_bills.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(payoff_bill, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定的付款账单表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.payoff_bills.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款账单表的id
                },
                output: {
                    200: {
                        body: payoff_bill
                    }
                }
            }
        })
        //获得指定条件付款账单表（全部倒叙）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.payoff_bills.getAllDescByCondition(),
            validate: {
                query: {
                    carrier_id: Joi.number().integer(), //承运商编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(payoff_bill, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定条件付款账单表（分页倒叙）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.payoff_bills.getPageDescByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    carrier_id: Joi.number().integer(), //承运商编号编号
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(payoff_bill, Joi.number().integer())
                    }
                }
            }
        })
        //创建付款账单
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.payoff_bills.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: payoff_bill_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //修改付款账单表
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.payoff_bills.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款账单表id
                },
                type: ['form', 'json'],
                body: payoff_bill_for_update
            }
        })
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.payoff_bills.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //付款账单表的主键
                }
            }
        })
        //批量删除付款账单，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.payoff_bills.batchDeleteByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //付款账单表表的id
                }
            }
        })
        .middleware()
    )
    //信用额度分配纪录【credit_limit_records】
    .use(
        '/credit_limit_records',
        router()
        //获得所有信用额度分配纪录（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.credit_limit_records.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(credit_limit_record)
                    }
                }
            }
        })
        //获得所有信用额度分配纪录（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.credit_limit_records.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                output: {
                    200: {
                        body: Joi.array().items(credit_limit_record, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定条件信用额度分配纪录（全部倒叙）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.credit_limit_records.getAllDescByCondition(),
            validate: {
                query: {
                    target_id: Joi.number().integer(), //接收者编号
                    offer_id: Joi.number().integer(), //提供者编号
                    target_type: Joi.number().integer(), //接收者类型
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(credit_limit_record, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定条件信用额度分配纪录（分页倒叙）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.credit_limit_records.getPageDescByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    target_id: Joi.number().integer(), //接收者编号
                    offer_id: Joi.number().integer(), //提供者编号
                    target_type: Joi.number().integer(), //接收者类型
                    start_time: Joi.date(), //开始时间
                    end_time: Joi.date(), //结束时间
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(credit_limit_record, Joi.number().integer())
                    }
                }
            }
        })
        //获得指定的信用额度分配纪录（单个）
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.credit_limit_records.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //信用额度分配记录的id
                },
                output: {
                    200: {
                        body: credit_limit_record
                    }
                }
            }
        })
        //创建信用额度分配纪录
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.credit_limit_records.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: credit_limit_record_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        //修改信用额度分配纪录
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.credit_limit_records.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //信用额度分配id
                },
                type: ['form', 'json'],
                body: credit_limit_record_for_create
            }
        })
        //删除信用额度记录
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.credit_limit_records.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //信用额度分配的主键
                }
            }
        })
        //批量删除信用额度记录，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.credit_limit_records.batchDeleteSelfByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //信用额度分配的主键表的id
                }
            }
        })
        .middleware()
    )
    //运输款项类型（transport_fund_types） transport_fund_type
    .use('/transport_fund_types', router()
        //运输款项类型
        .route({
            path: '/',
            method: 'get',
            handler: handlers.transport_fund_types.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(transport_fund_type)
                    }
                }
            }
        })
        //运输指定款项类型
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.transport_fund_types.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //款项类型编号
                },
                output: {
                    200: {
                        body: transport_fund_type
                    }
                }
            }
        })
        .middleware()
    )
    //客户充值记录表【user_pay_records】
    .use(
        '/user_pay_records',
        router()
        //获得所有客户充值记录（全部）
        .route({
            path: '/',
            method: 'get',
            handler: handlers.user_pay_records.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(user_pay_record)
                    }
                }
            }
        })
        //获得所有客户充值记录（分页）
        .route({
            path: '/page',
            method: 'get',
            handler: handlers.user_pay_records.getAllPage(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1) //第几页
                },
                /*output: {
                    200: {
                        body: Joi.array().items(user_pay_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //获得指定的客户充值记录（单个）
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.user_pay_records.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //客户充值记录表的id
                },
                output: {
                    200: {
                        body: user_pay_record
                    }
                }
            }
        })
        //获得指定条件用户的客户充值记录表（全部）
        .route({
            path: '/search/all',
            method: 'get',
            handler: handlers.user_pay_records.getAllByCondition(),
            validate: {
                query: {
                    user_id: Joi.number().integer(), //客户编号
                    start_time: Joi.date(),	//开始时间
                    end_time: Joi.date(),	//结束时间
	            min_balance: Joi.number().integer(), //最小金额
                    max_balance: Joi.number().integer(), //最大金额
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                output: {
                    200: {
                        body: Joi.array().items(user_pay_record)
                    }
                }
            }
        })
        //获得指定条件客户充值记录表（分页）
        .route({
            path: '/search/page',
            method: 'get',
            handler: handlers.user_pay_records.getPageByCondition(),
            validate: {
                query: {
                    size: Joi.number().integer().min(1).max(5000).default(100), //单页数量
                    page: Joi.number().integer().min(1), //第几页
                    user_id: Joi.number().integer(), //客户编号
                    start_time: Joi.date(),	//开始时间
                    end_time: Joi.date(),	//结束时间
	            min_balance: Joi.number().integer(), //最小金额
                    max_balance: Joi.number().integer(), //最大金额
                    status: Joi.number().integer() //状态
                },
                type: ['form', 'json'],
                /*output: {
                    200: {
                        body: Joi.array().items(user_pay_record, Joi.number().integer())
                    }
                }*/
            }
        })
        //创建某一条客户充值记录
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.user_pay_records.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: user_pay_record_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //创建成功的id
                    }
                }
            }
        })
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.user_pay_records.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //客户充值记录表的主键
                }
            }
        })
        //批量删除明细，参数直接放到地址栏上
        .route({
            path: '/datch/:ids',
            method: ['delete'],
            handler: handlers.user_pay_records.batchDeleteByIds(),
            validate: {
                params: {
                    ids: Joi.array().items(Joi.number().integer().required()) //客户充值记录表表的id
                }
            }
        })
        .middleware()
    )
    .use(
        '/station_cards',
        router()
        //获得所有子账户卡表信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.station_cards.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(station_card)
                    }
                }
            }
        })
        //获得指定子账户卡表信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.station_cards.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //子账户卡表编号
                },
                output: {
                    200: {
                        body: station_card
                    }
                }
            }
        })
        //添加子账户卡表信息
        .route({
            path: '/',
            method: ['post'],
            handler: handlers.station_cards.createSelf(),
            validate: {
                type: ['form', 'json'],
                body: station_card_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //子账户卡表编号
                    }
                }
            }
        })
        //删除子账户卡表信息
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.station_cards.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //子账户卡表编号
                }
            }
        })
        //修改子账户卡表信息
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.station_cards.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //子账户卡表编号
                },
                type: ['form', 'json'],
                body: station_card_for_change
            }
        })
        .middleware()
    )
	   .use(
        '/pay_channels',
        router()
        //获得所有支付渠道表信息
        .route({
            path: '/',
            method: 'get',
            handler: handlers.pay_channels.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(pay_channel)
                    }
                }
            }
        })
        //获得指定支付渠道表信息
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.pay_channels.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                output: {
                    200: {
                        body: pay_channel
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/line_assign_accounts',
        router()
        //获得所有线路单号分配账号表
        .route({
            path: '/',
            method: 'get',
            handler: handlers.line_assign_accounts.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(line_assign_account)
                    }
                }
            }
        })
        //获得指定线路单号分配账号表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.line_assign_accounts.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路单号分配账号表编号
                },
                output: {
                    200: {
                        body: line_assign_account
                    }
                }
            }
        })
        //添加线路单号分配账号表
        .route({
            path: '/line/:id',
            method: ['post'],
            handler: handlers.line_assign_accounts.addSelfByLineId(),
            validate: {
                type: ['form', 'json'],
	              params: {
                    id: Joi.number().integer().required() //运营线路编号
                },
                body: line_assign_account_for_create,
                output: {
                    200: {
                        body: Joi.number().integer() //线路单号分配账号表编号
                    }
                }
            }
        })
        //删除线路单号分配账号表
        .route({
            path: '/:id',
            method: ['delete'],
            handler: handlers.line_assign_accounts.deleteSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路单号分配账号表编号
                }
            }
        })
        //修改线路单号分配账号表
        .route({
            path: '/:id',
            method: ['put', 'patch'],
            handler: handlers.line_assign_accounts.modifySelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //线路单号分配账号表编号
                },
                type: ['form', 'json'],
                body: line_assign_account_for_create
            }
        })
        .middleware()
    )
	.use(
        '/assign_types',
        router()
        //获得所有订单分配类型表
        .route({
            path: '/',
            method: 'get',
            handler: handlers.assign_types.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(assign_type)
                    }
                }
            }
        })
        //获得指定订单分配类型表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.assign_types.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                output: {
                    200: {
                        body: assign_type
                    }
                }
            }
        })
        .middleware()
    )
	.use(
        '/trace_types',
        router()
        //获得跟踪类型表
        .route({
            path: '/',
            method: 'get',
            handler: handlers.trace_types.getAll(),
            validate: {
		            /*
                output: {
                    200: {
                        body: Joi.array().items(trace_type)
                    }
                }
		              */
            }
        })
        //获得指定跟踪类型表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.trace_types.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                output: {
                    200: {
                        body: trace_type
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/template_types',
        router()
        //获得模版类型表
        .route({
            path: '/',
            method: 'get',
            handler: handlers.template_types.getAll(),
            validate: {
                output: {
                    200: {
                        body: Joi.array().items(template_type)
                    }
                }
            }
        })
        //获得模版类型表
        .route({
            path: '/:id',
            method: 'get',
            handler: handlers.template_types.getSelfById(),
            validate: {
                params: {
                    id: Joi.number().integer().required() //编号
                },
                output: {
                    200: {
                        body: template_type
                    }
                }
            }
        })
        .middleware()
    )
    .use(
        '/tests',
        router()
        //.route({path: '/:id', method: 'get', handler: [admin_verify, controllers.Generals.index('test', ['id', 'name', 'time', 'created_at'])]
        //获取指定订单
        .route({
            path: '/:id',
            method: 'post',
            handler: handlers.tests.getOrderById(),
            validate: {
                params: {
                    id: Joi.number().integer().required().allow(null) //运输编号
                },
                type: ['form', 'json'],
                body: { id: Joi.number().integer().required().allow(null) }
            }
        })
        //获取指定订单
        /*.route({path: '/', method: 'post', handler: [admin_verify, controllers.Generals.create('test')]
          ,validate: {
          }
        })*/
        //获取指定订单
        .route({
            path: '/mytest/1',
            method: 'get',
            handler: handlers.tests.getOrderById1(),
            validate: {}
        })
        //获取指定订单
        .route({
            path: '/mytest/2',
            method: 'get',
            handler: handlers.tests.getOrderById2(),
            validate: {}
        })
        //获取指定订单
        .route({
            path: '/:id/:name',
            method: 'get',
            handler: handlers.tests.getOrderById3(),
            validate: {
                query: {
                    restart: Joi.boolean().truthy('Y').falsy('N').default(true), //是否强制重复发送，默认不重复
                    start: Joi.string().default('100') //是否强制重复发送，默认不重复
                },
                params: {
                    id: Joi.number().integer().required(), //运输编号
                    name: Joi.string().required() //运输编号
                }
            }
        })
        //获取指定订单
        .route({
            path: '/',
            method: 'get',
            handler: handlers.tests.getOrderById4(),
            validate: {}
        })
        //获取指定订单
        .route({
            path: '/abc',
            method: 'post',
            handler: handlers.tests.getOrderById5(),
            validate: {}
        })
        .middleware()
    )

module.exports = routers.middleware();
