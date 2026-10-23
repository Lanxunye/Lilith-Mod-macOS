#include <dispatch/dispatch.h>
#include <stdint.h>

__attribute__((visibility("default")))
void lilith_schedule_main(void *context, dispatch_function_t callback, double delay) {
    dispatch_after_f(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), context, callback);
}
