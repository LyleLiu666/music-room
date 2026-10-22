#include <libproc.h>
#include <sys/resource.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mach/mach.h>
#include <sys/sysctl.h>

static int system_memory(void) {
    vm_size_t page_size = 0;
    vm_statistics64_data_t vm = {0};
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    uint64_t capacity = 0;
    size_t size = sizeof(capacity);
    struct xsw_usage swap = {0};
    size_t swap_size = sizeof(swap);
    mach_port_t host = mach_host_self();
    kern_return_t pages = host_page_size(host, &page_size);
    kern_return_t stats = host_statistics64(host, HOST_VM_INFO64, (host_info64_t)&vm, &count);
    mach_port_deallocate(mach_task_self(), host);
    if (pages != KERN_SUCCESS || stats != KERN_SUCCESS ||
        sysctlbyname("hw.memsize", &capacity, &size, NULL, 0) ||
        sysctlbyname("vm.swapusage", &swap, &swap_size, NULL, 0)) {
        fprintf(stderr, "system memory counters unavailable\n");
        return 1;
    }
    /* free_count already includes speculative pages. Other categories overlap. */
    printf("{\"capacity\":%llu,\"free\":%llu,\"purgeable\":%llu,\"inactive\":%llu,\"fileBacked\":%llu,\"compressed\":%llu,\"wired\":%llu,\"swapUsed\":%llu,\"swapInBytes\":%llu,\"swapOutBytes\":%llu}\n",
        (unsigned long long)capacity,
        (unsigned long long)vm.free_count * page_size,
        (unsigned long long)vm.purgeable_count * page_size,
        (unsigned long long)vm.inactive_count * page_size,
        (unsigned long long)vm.external_page_count * page_size,
        (unsigned long long)vm.compressor_page_count * page_size,
        (unsigned long long)vm.wire_count * page_size,
        (unsigned long long)swap.xsu_used,
        (unsigned long long)vm.swapins * page_size,
        (unsigned long long)vm.swapouts * page_size);
    return 0;
}

/* Kernel ownership counters include compressed memory; no VM-map scan or task suspension. */
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    if (!strcmp(argv[1], "system")) return system_memory();
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
