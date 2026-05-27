package common

import (
	"flag"
	"fmt"
	"os"

	"github.com/53AI/53AIHub/config"
)

var (
	Port         = flag.Int("1port", 3000, "the listening port")
	PrintVersion = flag.Bool("1version", false, "print version and exit")
	PrintHelp    = flag.Bool("1help", false, "print help and exit")
	LogDir       = flag.String("1log-dir", "./logs", "specify the log directory")
)

func printHelp() {
	// TODO: print help
	fmt.Println("53AIHub Api " + config.Version + " - Fast, simple, and efficient AI WebSite.")
	fmt.Println("Copyright (C) 2025 Liuzimu. All rights reserved.")
	fmt.Println("GitHub: xxx")
	fmt.Println("Usage: 53AIHub [--port <port>] [--log-dir <log directory>] [--version] [--help]")
}

func Init() {
	if !flag.Parsed() {
		flag.Parse()
	}

	if *PrintHelp {
		printHelp()
		os.Exit(0) // 仅在 --help 参数存在时退出
	}

	if *PrintVersion {
		fmt.Println(config.Version)
		os.Exit(0) // 仅在 --version 参数存在时退出
	}

	// Initialize the logger
	InitRedisClient()
	InitLocker()
}
