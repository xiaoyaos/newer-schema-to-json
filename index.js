'use strict'

const fs = require('fs');
const assert = require('assert');
const parserRouter = require('./lib/parser-router');
const parserSchema = require('./lib/parser-schema');
const writeJson = require('writejson');
var routesContent;
var requireList = [];
var schemaList = [];
var routerList = {
  mainPaths:[]
};
fs.readFile('./routes.js', pretreatment);

function pretreatment(err, data){
  if (err) throw err;
  routesContent = data.toString();
  //删除注释
  var oneLine = /(?<!:)\/\/.*/g;  //单行注释匹配规则

  var lump = /\/\*(\s|.)*?\*\//g; //块级注释匹配规则

  var empty = /\s*/g;             //空白行匹配
  routesContent = routesContent.replace(/(?<!:)\/\/.*/g,"");
  routesContent = routesContent.replace(/(?<!:)\/\/.*/g,"");
  routesContent = routesContent.replace(/\/\*(\s|.)*?\*\//g,"");
  // console.log(routesContent);

  //拿到需要require的包名或路径
　requireList = routesContent.match(/const .*= require\(\'.*[);$]/g);
  getRequirePak();

  //去除require
  routesContent = routesContent.replace(/const .*= require\(\'.*[);$]/g,"");

  //拿到定义的schama
  schemaList = routesContent.match(/const .*= {(\s|.)*?[}$]/g);
  var schemaList1 = routesContent.match(/const\s*?error_info(\s|.)*?routers/g)[0];
  schemaList1 = schemaList1.match(/const .*= (\s|.)*?(\);|\};)/g);
  //去掉schama
  routesContent = routesContent.replace(/const .*= {(\s|.)*?[}$]/g,"");

  // console.log(routerList.length);
  var result = routesContent.match(/\.use\((\s|.)*?\.middleware\(\)\s*?\)/g);
  var len = result.length;
  //去除路由空格换行
  for(let i = 0; i <= len-1; i++){
    result[i] = result[i].replace(/\s*/g,"");
  }


  parserSchema(schemaList1);
  // parserRouter(result);
}

/**
 *  获取reuiqre的包名
 */
function getRequirePak(){
  var reg = /(?<=\')[^\']+/g;
  for(let k in requireList){
    requireList[k] = requireList[k].match(reg)[0];
  }
  // console.log(requireList);
}
