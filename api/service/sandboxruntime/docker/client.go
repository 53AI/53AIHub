package docker

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

type Client struct {
	ContainerID string
}

func (c *Client) Exec(ctx context.Context, args ...string) (string, string, int, error) {
	cmdArgs := append([]string{"exec", c.ContainerID}, args...)
	cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
			err = nil
		} else {
			return "", "", -1, fmt.Errorf("docker exec failed: %w", err)
		}
	}
	return stdout.String(), stderr.String(), exitCode, nil
}

func (c *Client) ExecWithStdin(ctx context.Context, stdin []byte, args ...string) (string, string, int, error) {
	cmdArgs := append([]string{"exec", "-i", c.ContainerID}, args...)
	cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.Stdin = bytes.NewReader(stdin)
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
			err = nil
		} else {
			return "", "", -1, fmt.Errorf("docker exec failed: %w", err)
		}
	}
	return stdout.String(), stderr.String(), exitCode, nil
}

func SanitizeName(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ToLower(s)
	s = strings.NewReplacer(":", "-", "/", "-", " ", "-", "_", "-").Replace(s)
	if s == "" {
		return "sandbox"
	}
	return s
}
