package weboffice

/**本文件是 WPS SDK 的代码示例现在注释掉**/
// import (
// 	"github.com/gin-gonic/gin"
// 	"log"
// 	"net/http"
// 	"os"
// 	"strconv"
// 	"time"
// )

// func init() {
// 	if os.Getenv("DEBUG") == "" {
// 		gin.SetMode(gin.ReleaseMode)
// 	}
// }

// type Server struct {
// 	config Config
// 	engine *gin.Engine
// 	root   gin.IRouter
// }

// func (srv *Server) wrapHandlerFunc(f func(*gin.Context) (any, error)) gin.HandlerFunc {
// 	return func(c *gin.Context) {
// 		begin := time.Now()
// 		data, err := f(c)
// 		cost := time.Since(begin)

// 		if err != nil {
// 			var respErr *Error
// 			if e, ok := err.(*Error); ok {
// 				respErr = e
// 			} else {
// 				respErr = ErrInternalError.WithMessage(err.Error())
// 			}

// 			c.JSON(respErr.StatusCode(), &Reply{Code: respErr.Code(), Message: respErr.Message()})
// 			srv.config.Logger.Error("%s %s code=%d message=%s cost=%s", c.Request.Method, c.Request.RequestURI, respErr.Code(), cost.String())
// 		} else {
// 			c.JSON(http.StatusOK, &Reply{Code: OK, Data: data})
// 			srv.config.Logger.Info("%s %s code=OK cost=%s", c.Request.Method, c.Request.RequestURI, cost.String())
// 		}
// 	}
// }

// func (srv *Server) registerRoutes(router gin.IRouter) {
// 	router.GET("/v3/3rd/files/:file_id", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 		fileID := c.Param("file_id")
// 		ctx := ParseContext(c.Request)

// 		return srv.config.GetFile(ctx, fileID)
// 	}))
// 	router.GET("/v3/3rd/files/:file_id/download", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 		fileID := c.Param("file_id")
// 		ctx := ParseContext(c.Request)

// 		return srv.config.GetFileDownload(ctx, fileID)
// 	}))
// 	router.GET("/v3/3rd/files/:file_id/permission", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 		fileID := c.Param("file_id")
// 		ctx := ParseContext(c.Request)

// 		return srv.config.GetFilePermission(ctx, fileID)
// 	}))

// 	if srv.config.UserProvider != nil {
// 		router.GET("/v3/3rd/users", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			userIDs := c.QueryArray("user_ids")
// 			ctx := ParseContext(c.Request)

// 			return srv.config.GetUsers(ctx, userIDs)
// 		}))
// 	}
// 	if srv.config.WatermarkProvider != nil {
// 		router.GET("/v3/3rd/files/:file_id/watermark", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			fileID := c.Param("file_id")
// 			ctx := ParseContext(c.Request)

// 			return srv.config.GetFileWatermark(ctx, fileID)
// 		}))
// 	}

// 	if srv.config.EditProvider != nil {
// 		router.POST("/v3/3rd/files/:file_id/upload", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			fileID := c.Param("file_id")
// 			ctx := ParseContext(c.Request)

// 			fileHeader, err := c.FormFile("file")
// 			if err != nil {
// 				return nil, ErrInvalidArguments.WithMessage(err.Error())
// 			}
// 			f, err := fileHeader.Open()
// 			if err != nil {
// 				return nil, ErrInternalError.WithMessage(err.Error())
// 			}
// 			defer f.Close()

// 			var args UpdateFile1PhaseArgs
// 			args.Name = c.PostForm("name")
// 			args.SHA1 = c.PostForm("sha1")
// 			args.Size, _ = strconv.ParseInt(c.PostForm("size"), 10, 64)
// 			args.IsManual, _ = strconv.ParseBool(c.PostForm("is_manual"))
// 			args.Content = f

// 			return srv.config.UpdateFile(ctx, fileID, &args)
// 		}))

// 		router.PUT("/v3/3rd/files/:file_id/name", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			ctx := ParseContext(c.Request)
// 			fileID := c.Param("file_id")

// 			var args RenameFileArgs
// 			if err := c.BindJSON(&args); err != nil {
// 				return nil, ErrInvalidArguments.WithMessage(err.Error())
// 			}
// 			if err := srv.config.RenameFile(ctx, fileID, &args); err != nil {
// 				return nil, err
// 			} else {
// 				return &Empty{}, nil
// 			}
// 		}))
// 	}

// 	if srv.config.VersionProvider != nil {
// 		router.GET("/v3/3rd/files/:file_id/versions", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			ctx := ParseContext(c.Request)
// 			fileID := c.Param("file_id")
// 			versionID, _ := strconv.Atoi(c.Param("version"))
// 			offset, _ := strconv.Atoi(c.Query("offset"))
// 			limit, _ := strconv.Atoi(c.Query("limit"))

// 			return srv.config.VersionProvider.GetFileVersions(ctx, fileID, int32(versionID), offset, limit)
// 		}))
// 		router.GET("/v3/3rd/files/:file_id/versions/:version", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			ctx := ParseContext(c.Request)
// 			fileID := c.Param("file_id")
// 			versionID, _ := strconv.Atoi(c.Param("version"))

// 			return srv.config.VersionProvider.GetFileVersion(ctx, fileID, int32(versionID))
// 		}))
// 		router.GET("/v3/3rd/files/:file_id/versions/:version/download", srv.wrapHandlerFunc(func(c *gin.Context) (any, error) {
// 			ctx := ParseContext(c.Request)
// 			fileID := c.Param("file_id")
// 			versionID, _ := strconv.Atoi(c.Param("version"))

// 			return srv.config.VersionProvider.GetFileVersionDownload(ctx, fileID, int32(versionID))
// 		}))
// 	}
// }

// func NewServer(config Config) *Server {
// 	if config.BaseProvider == nil {
// 		log.Panic("BaseProvider must not nil")
// 	}
// 	if config.Logger == nil {
// 		config.Logger = &noopLogger{}
// 	}
// 	srv := &Server{
// 		engine: gin.New(),
// 		config: config,
// 	}
// 	if config.Prefix == "" {
// 		srv.root = srv.engine
// 	} else {
// 		srv.root = srv.engine.Group(config.Prefix)
// 	}

// 	srv.registerRoutes(srv.root)
// 	return srv
// }

// func (srv *Server) Run(addr string) error {
// 	return srv.engine.Run(addr)
// }

// func (srv *Server) Router() gin.IRouter {
// 	return srv.root
// }

// func (srv *Server) Handler() http.Handler {
// 	return srv.engine
// }
