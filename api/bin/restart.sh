#!/bin/bash

# 1. 找到 53aihub 运行的 pid 
PID=$(ps aux | grep '[5]3aihub' | awk '{print $2}')

# 2. 优雅 kill 掉
if [ -n "$PID" ]; then
    echo "找到 53aihub 进程 PID: $PID，正在停止..."
    kill -15 $PID
    sleep 2 # 等待进程结束
else
    echo "未找到正在运行的 53aihub 进程"
fi

# 3. 后台运行 53aihub 并且输出日志到当前目录
echo "启动 53aihub..."
nohup ./53aihub > ./53aihub.log 2>&1 &

echo "53aihub 已启动，日志输出到 ./53aihub.log"
