#Requires -Version 5.1
# 站点可爬取性探测脚本 (杭州数据)
# 输出: 每个目标的 HTTP 状态码 / 响应大小 / 前 300 字符预览

$ErrorActionPreference = 'Continue'
$outDir = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function Invoke-Probe {
    param(
        [string]$Name,
        [string]$Url,
        [hashtable]$Headers = @{},
        [string]$Method = 'GET',
        [string]$Body = $null,
        [string]$ContentType = $null
    )
    $h = @{ 'User-Agent' = $UA_PC; 'Accept-Language' = 'zh-CN,zh;q=0.9' }
    foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] }
    $result = [ordered]@{
        name = $Name
        url  = $Url
        status = $null
        bytes = 0
        server = ''
        contentType = ''
        preview = ''
        error = ''
        note = ''
    }
    try {
        $params = @{
            Uri = $Url; Headers = $h; Method = $Method
            TimeoutSec = 20; MaximumRedirection = 5
            UseBasicParsing = $true
        }
        if ($Body) { $params['Body'] = $Body }
        if ($ContentType) { $params['ContentType'] = $ContentType }
        $r = Invoke-WebRequest @params
        $result.status = [int]$r.StatusCode
        $result.bytes = $r.RawContentLength
        $result.server = [string]$r.Headers['Server']
        $result.contentType = [string]$r.Headers['Content-Type']
        $raw = $r.Content
        if ($raw -is [byte[]]) { $raw = [System.Text.Encoding]::UTF8.GetString($raw) }
        $result.preview = ($raw -replace '\s+', ' ').Substring(0, [Math]::Min(300, $raw.Length))
        $file = Join-Path $outDir ("{0}.txt" -f ($Name -replace '[^\w\-]', '_'))
        Set-Content -Path $file -Value $raw -Encoding UTF8
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            try { $result.status = [int]$resp.StatusCode } catch {}
            try { $result.server = [string]$resp.Headers['Server'] } catch {}
        }
        $result.error = $_.Exception.Message
    }
    [pscustomobject]$result
}

$targets = @(
    # 高德 - 官方 Web 服务 REST API (需 key, 无 key 看返回)
    @{ n='amap_rest_search_nokey'; u='https://restapi.amap.com/v3/place/text?keywords=%E7%81%AB%E9%94%85&city=%E6%9D%AD%E5%B7%9E&offset=5&page=1&key=TEST' }
    # 高德 - 网页版搜索接口 (公开 web api, 无需 key)
    @{ n='amap_webapi_typing'; u='https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=12&city=330100&keywords=%E7%81%AB%E9%94%85' }
    @{ n='amap_webapi_city'; u='https://www.amap.com/service/cityList?version=2024' }
    # 高德 - POI 详情页 (可点击跳转的链接形态)
    @{ n='amap_poi_page'; u='https://www.amap.com/place/B023B0A6VD' }
    @{ n='amap_uri_scheme_note'; u='https://uri.amap.com/marker?position=120.1551,30.2741&name=%E6%B5%8B%E8%AF%95' }
    # 小红书
    @{ n='xhs_home'; u='https://www.xiaohongshu.com/explore' }
    @{ n='xhs_search_page'; u='https://www.xiaohongshu.com/search_result?keyword=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F' }
    @{ n='xhs_webapi_search'; u='https://edith.xiaohongshu.com/api/sns/web/v1/search/notes' }
    # 大众点评
    @{ n='dianping_home'; u='https://www.dianping.com/hangzhou/ch10' }
    @{ n='dianping_search'; u='https://www.dianping.com/search/keyword/3/0_%E7%81%AB%E9%94%85' }
    # 美团
    @{ n='meituan_home'; u='https://hz.meituan.com/' }
    @{ n='meituan_meishi'; u='https://hz.meituan.com/meishi/' }
    # 携程
    @{ n='ctrip_attraction_list'; u='https://you.ctrip.com/sight/hangzhou14.html' }
    @{ n='ctrip_search_api'; u='https://m.ctrip.com/restapi/soa2/13444/json/getCommentCollapseList' }
    # 马蜂窝
    @{ n='mafengwo_hangzhou'; u='https://www.mafengwo.cn/jd/10210/gonglve.html' }
    @{ n='mafengwo_search_api'; u='https://www.mafengwo.cn/search/q.php?q=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F' }
    # 去哪儿
    @{ n='qunar_hangzhou'; u='https://touch.qunar.com/' }
    # 百度地图
    @{ n='baidu_map_place_api'; u='https://map.baidu.com/?qt=s&wd=%E7%81%AB%E9%94%85&c=179' }
    # 腾讯地图
    @{ n='qq_map_place'; u='https://apis.map.qq.com/ws/place/v1/search?keyword=%E7%81%AB%E9%94%85&boundary=region(%E6%9D%AD%E5%B7%9E,0)&key=TEST' }
    # 同程 / 飞猪
    @{ n='ly_ly'; u='https://www.ly.com/' }
    @{ n='fliggy'; u='https://www.fliggy.com/' }
    # 抖音 / 哔哩哔哩 (内容侧参考)
    @{ n='bilibili_search_api'; u='https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F' }
    # 政府/开放数据: 杭州市文化广电旅游局 (景点名录)
    @{ n='hangzhou_gov_tour'; u='https://wgly.hangzhou.gov.cn/' }
    # 通用连通性对照
    @{ n='example_com'; u='https://example.com/' }
)

$results = foreach ($t in $targets) {
    Write-Host ("probe -> {0}" -f $t.n)
    Invoke-Probe -Name $t.n -Url $t.u
}

$results | Select-Object name, status, bytes, server, contentType, error, note |
    Format-Table -AutoSize -Wrap | Out-String -Width 400 | Write-Host

$results | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $outDir 'probe-results.json') -Encoding UTF8
Write-Host "saved: $outDir\probe-results.json"
