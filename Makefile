# Cocotb testbench for rheon_core. Top = rheon_core; pipeline monitor uses internal hierarchy.

TOPLEVEL_LANG = SystemVerilog
TOPLEVEL = rheon_core

RHEON_RTL = rheon_core/rheon_pkg.sv \
	rheon_core/alu.sv \
	rheon_core/gpr_file.sv \
	rheon_core/decode.sv \
	rheon_core/fetch.sv \
	rheon_core/execute.sv \
	rheon_core/commit.sv \
	rheon_core/rheon_core.sv

VERILOG_SOURCES = $(RHEON_RTL)

MODULE = testcases.test_elf
TESTCASE =

# ELF to load: pass via command line, e.g. make run ELF=build/out.elf
ELF ?=
export TEST_ELF := $(ELF)

# Seed for cocotb (reproducible runs); e.g. make run RANDOM_SEED=42
ifneq ($(RANDOM_SEED),)
export RANDOM_SEED := $(RANDOM_SEED)
endif

# Default simulator: verilator. Use SIM=icarus for Icarus.
SIM ?= verilator

# Cocotb's Verilator backend only advertises Verilog support; it skips
# when TOPLEVEL_LANG is set to SystemVerilog. Our RTL is in .sv files,
# which Verilator accepts even when TOPLEVEL_LANG=verilog, so select a
# language per-simulator to keep verilator working.
ifeq ($(SIM),verilator)
	TOPLEVEL_LANG = verilog
else
	TOPLEVEL_LANG = SystemVerilog
endif

# Icarus: SystemVerilog support
ifeq ($(SIM),icarus)
	COMPILE_ARGS += -g2012
endif

# Python path so cocotb can import tb
export PYTHONPATH := $(PWD):$(PYTHONPATH)

include $(shell cocotb-config --makefiles)/Makefile.sim

# Convenience target: run simulation (ELF via make run ELF=path/to.elf)
run: sim
