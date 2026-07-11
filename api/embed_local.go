//go:build !saas

package main

import "embed"

// 本地部署版本(一体化部署):包含前端静态资源
//
//go:embed static/images static/libs static/docs all:static/front all:static/console
var buildFS embed.FS
