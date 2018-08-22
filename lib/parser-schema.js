const fs = require('fs');
const writeJson = require('writejson');
// const router = require('logoran-joi-router');
// const Joi = router.Joi;
const Joi = require('joi')
const j2s = require('joi-to-swagger');
module.exports = function(schemaList){

  var schemas = {};
  for(let i = 0; i <= schemaList.length-1; i++){
    let name = schemaList[i].match(/(?<=const)[^=]+/g);
    name = name[0].replace(/\s+/g,"");

    schemaList[i] = schemaList[i].replace(/const/g,"var ");
    eval(schemaList[i]);
    let swagger = j2s(eval(name));
    schemas[name] = swagger.swagger;
  }
  // console.log("\r\n",schemas);
  writeJson("./generate-file/schema.json",schemas,(err)=>{
    if(err) console.log(err);
  });
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
}
