"""Executed as a separate process; limits never affect the API interpreter."""
import os
import resource
import sys

memory, file_size, seconds = map(int, sys.argv[1:4])
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
resource.setrlimit(resource.RLIMIT_FSIZE, (file_size, file_size))
resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds + 1))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
os.execvp(sys.argv[4], sys.argv[4:])
