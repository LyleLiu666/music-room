#include <libproc.h>
#include <sys/resource.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Kernel ownership counters include compressed memory; no VM-map scan or task suspension. */
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char *end = NULL;
    errno = 0;
    long pid = strtol(argv[1], &end, 10);
    if (errno || !end || *end || pid <= 0 || pid > INT_MAX) return 2;
    struct rusage_info_v4 usage = {0};
    if (proc_pid_rusage((int)pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) {
        fprintf(stderr, "proc_pid_rusage pid=%ld: %s (errno=%d)\n", pid, strerror(errno), errno);
        return 1;
    }
    printf("{\"pid\":%ld,\"bytes\":%llu}\n", pid, (unsigned long long)usage.ri_phys_footprint);
    return 0;
}
