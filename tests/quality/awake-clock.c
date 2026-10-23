#include <mach/mach_time.h>
#include <stdio.h>

/* mach_absolute_time measures awake uptime; mach_continuous_time includes sleep. */
int main(void) {
    mach_timebase_info_data_t base;
    if (mach_timebase_info(&base) != KERN_SUCCESS || !base.denom) return 1;
    long double nanoseconds = (long double)mach_absolute_time() * base.numer / base.denom;
    printf("%.3Lf\n", nanoseconds / 1000000.0L);
    return 0;
}
