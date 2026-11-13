/**
 * 入口页共享启动脚本（index.html 内联脚本的抽取版，供 website.html / client.html / erhao.html 复用）。
 * 负责：URL 参数中的 api_host / qyy_host 注入、OAuth provider 回调 postMessage、
 * access_token 免登写入。必须在 module 脚本（main.tsx）加载前执行。
 */
function getSearchParam() {
  var search = location.search.split('?')[1] || ''
  var reg = /([^?&=]+)=([^?&=]+)/g
  var params = {}
  search.match(reg)?.forEach(function (item) {
    var kv = item.split('=')
    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '')
  })
  return params
}

function joinSearchParam(params = {}) {
  var search = ''
  Object.keys(params).forEach(function (key) {
    search += key + '=' + params[key] + '&'
  })
  if (search) search = '?' + search
  return search
}

var search_params = getSearchParam()
if (search_params.api_host)
  window.api_host =
    'http://' +
    search_params.api_host.replace(/^https?:\/\//, '').replace(/\/$/, '')
if (search_params.qyy_host)
  window.qyy_host =
    'http://' +
    search_params.qyy_host.replace(/^https?:\/\//, '').replace(/\/$/, '')

if (search_params.provider_type) {
  if (window.opener) {
    window.opener.postMessage(
      {
        provider_type: search_params.provider_type,
        provider_id: search_params.provider_id,
        is_authorized: search_params.is_authorized
      },
      '*'
    )
  } else {
    window.postMessage(
      {
        provider_type: search_params.provider_type,
        provider_id: search_params.provider_id,
        is_authorized: search_params.is_authorized
      },
      '*'
    )
  }
}

if (search_params.access_token) {
  // 直接覆盖写入 access_token，不要先 removeItem——否则其它标签页会收到"token 被删除"
  // 的 storage 事件，触发多账号守卫的 onTokenRemoved 而无条件刷新（见 useMultiAccountGuard）
  localStorage.removeItem('user_info')
  localStorage.setItem('access_token', search_params.access_token)
  localStorage.setItem(
    'user_info',
    JSON.stringify({
      access_token: search_params.access_token,
      user_id: '',
      eid: search_params.eid
    })
  )
  delete search_params.access_token
  delete search_params.eid
  if (search_params.from_origin) {
    sessionStorage.setItem('from_origin', decodeURIComponent(search_params.from_origin))
    delete search_params.from_origin
  }
  location.search = joinSearchParam(search_params)
}
