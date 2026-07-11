package router

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/gin-gonic/gin"
)

const (
	pathAPI     = "/api/"
	pathStatic  = "/static/"
	pathConsole = "/console"
	pathAssets  = "/assets/"
	pathImages  = "/images/"
)

const contentTypeHTML = "text/html; charset=utf-8"

// serveHTMLFile handles HTML file requests
func serveHTMLFile(c *gin.Context, fsys fs.FS, filename string, logMsg string) {
	// logger.SysLog(logMsg)
	c.Header("Content-Type", contentTypeHTML)
	c.Status(http.StatusOK)

	content, err := fs.ReadFile(fsys, filename)
	if err != nil {
		logger.SysLogf("Failed to read file %s: %v", filename, err)
		c.String(http.StatusInternalServerError, "Failed to read file: "+err.Error())
		return
	}

	c.Writer.Write(content)
}

// serveStaticFile handles static resource file requests
func serveStaticFile(c *gin.Context, fsys fs.FS, filepath string, logMsg string) {
	// logger.SysLogf(logMsg)

	content, fileErr := fs.ReadFile(fsys, filepath)
	if fileErr != nil {
		logger.SysLogf("Failed to read file %s: %v", filepath, fileErr)
		c.String(http.StatusNotFound, "File not found")
		return
	}

	// Set appropriate Content-Type based on file extension
	contentType := "application/octet-stream"
	if strings.HasSuffix(filepath, ".js") {
		contentType = "application/javascript"
	} else if strings.HasSuffix(filepath, ".css") {
		contentType = "text/css"
	} else if strings.HasSuffix(filepath, ".png") {
		contentType = "image/png"
	} else if strings.HasSuffix(filepath, ".jpg") || strings.HasSuffix(filepath, ".jpeg") {
		contentType = "image/jpeg"
	} else if strings.HasSuffix(filepath, ".svg") {
		contentType = "image/svg+xml"
	}

	c.Header("Content-Type", contentType)
	c.Status(http.StatusOK)
	c.Writer.Write(content)
}

// tryServeFile attempts to serve a file from the filesystem, returns false if file doesn't exist
func tryServeFile(c *gin.Context, fsys fs.FS, filePath string, logMsg string) bool {
	// Check if file exists
	_, err := fs.Stat(fsys, filePath)
	if err != nil {
		return false
	}

	// Determine if it's HTML or another static resource based on file extension
	if strings.HasSuffix(filePath, ".html") {
		serveHTMLFile(c, fsys, filePath, logMsg)
	} else {
		serveStaticFile(c, fsys, filePath, logMsg)
	}

	return true
}

// SetStaticRouter configures static file routes
func SetStaticRouter(router *gin.Engine, buildFS embed.FS) error {
	// 尝试获取前端资源,如果不存在则记录日志并跳过
	rendererSubFS, err := fs.Sub(buildFS, "static/front")
	if err != nil {
		logger.SysLog("static/front directory not found, skipping frontend routes")
		return nil
	}

	distSubFS, err := fs.Sub(buildFS, "static/console")
	if err != nil {
		logger.SysLog("static/console directory not found, skipping console routes")
		return nil
	}

	// Handle /static/* path requests (for all static files under /static directory)
	router.GET("/static/*filepath", func(c *gin.Context) {
		filepath := c.Param("filepath")
		staticPath := "static" + filepath

		// Try rendererSubFS first
		if tryServeFile(c, rendererSubFS, staticPath, "Processing /static request: "+staticPath) {
			return
		}

		// Try distSubFS if not found in rendererSubFS
		if tryServeFile(c, distSubFS, staticPath, "Processing /static request: "+staticPath) {
			return
		}

		c.String(http.StatusNotFound, "File not found")
	})

	// Handle assets path requests
	router.GET("/assets/*filepath", func(c *gin.Context) {
		filepath := c.Param("filepath")
		assetPath := "assets" + filepath
		serveStaticFile(c, rendererSubFS, assetPath, "Processing assets request: "+assetPath)
	})

	// Handle images path requests
	router.GET("/images/*filepath", func(c *gin.Context) {
		filepath := c.Param("filepath")
		imagePath := "images" + filepath
		serveStaticFile(c, rendererSubFS, imagePath, "Processing images request: "+imagePath)
	})

	// Handle root path request
	router.GET("/", func(c *gin.Context) {
		serveHTMLFile(c, rendererSubFS, "index.html", "Processing root path request")
	})

	// Handle all non-API and non-static resource requests
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// If it's an API route, return and let the API route handler handle it
		if strings.HasPrefix(path, pathAPI) {
			return
		}

		// If it's a static file route, return and let the static file handler handle it
		if strings.HasPrefix(path, pathStatic) {
			return
		}

		// If it's an assets or images path, return and let the dedicated handler handle it
		if strings.HasPrefix(path, pathAssets) || strings.HasPrefix(path, pathImages) {
			return
		}

		// If it's a console route, use the dist directory
		if strings.HasPrefix(path, pathConsole) {
			// Remove the "/console" prefix to get the relative path
			relativePath := strings.TrimPrefix(path, "/console")
			if relativePath == "" || relativePath == "/" {
				// If it's /console or /console/, return index.html from the dist directory
				serveHTMLFile(c, distSubFS, "index.html", "Processing console root path request: "+path)
				return
			}

			// Try to find the corresponding file in the dist directory
			filePath := strings.TrimPrefix(relativePath, "/")
			if tryServeFile(c, distSubFS, filePath, "Processing console file request: "+path) {
				return
			}

			// If the file doesn't exist, return index.html from the dist directory (for SPA frontend routing)
			serveHTMLFile(c, distSubFS, "index.html", "Processing console frontend route request: "+path)
			return
		}

		// Other routes use the renderer directory
		// Try to find the corresponding file in the renderer directory
		filePath := strings.TrimPrefix(path, "/")
		if filePath == "" {
			// If it's the root path, return index.html from the renderer directory
			serveHTMLFile(c, rendererSubFS, "index.html", "Processing root path request")
			return
		}

		// Try to find the corresponding file in the renderer directory
		if tryServeFile(c, rendererSubFS, filePath, "Processing renderer file request: "+path) {
			return
		}

		// If the file doesn't exist, return index.html from the renderer directory (for SPA frontend routing)
		serveHTMLFile(c, rendererSubFS, "index.html", "Processing frontend route request: "+path)
	})

	return nil
}
