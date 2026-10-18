/* FBI 原版解码器的测试入口 / Test entry point for FBI's original decoder. */
#include <stdio.h>
#include <string.h>
#include "quirc.h"

int main(void) {
    struct quirc_code code;
    struct quirc_data data;
    memset(&code, 0, sizeof(code));
    if (scanf("%d", &code.size) != 1 || code.size < 21 || code.size > 177) return 2;
    for (int i = 0; i < code.size * code.size; i++) {
        char cell;
        if (scanf(" %c", &cell) != 1 || (cell != '0' && cell != '1')) return 3;
        if (cell == '1') code.cell_bitmap[i >> 3] |= 1 << (i & 7);
    }
    int error = quirc_decode(&code, &data);
    if (error) {
        fprintf(stderr, "quirc_decode_error=%d\n", error);
        return 1;
    }
    fwrite(data.payload, 1, data.payload_len, stdout);
    return 0;
}
