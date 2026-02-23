/* SPDX-License-Identifier: MIT
 * Minimal linker script for bare-metal RISC-V ELF.
 * Entry: _start. Single loadable image for .text, .data, .bss.
 * Separate RX and RW segments to avoid RWX LOAD warning.
 */
OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY
{
  /* Base address common for simulators / bare-metal cores.
   * Tibbar generates code with .org; span can exceed 256KB. Use 512KB. */
  RAM (rwx) : ORIGIN = 0x80000000, LENGTH = 0x80000
}

PHDRS
{
  text PT_LOAD FLAGS(5); /* R + X (no W) */
  data PT_LOAD FLAGS(6); /* R + W (no X) */
}

SECTIONS
{
  .text : {
    *(.text .text.*)
  } > RAM :text

  .rodata : {
    *(.rodata .rodata.*)
  } > RAM :text

  .data : {
    *(.data .data.*)
  } > RAM :data

  .bss : {
    __bss_start = .;
    *(.bss .bss.*)
    *(COMMON)
    __bss_end = .;
    __heap_start = .;
    . = ALIGN(8);
    _end = .;
    __stack_top = ORIGIN(RAM) + LENGTH(RAM);
  } > RAM :data
}
