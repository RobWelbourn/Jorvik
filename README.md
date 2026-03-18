# Jorvik 
Configuration management for your TypeScript applications

## Overview

Jorvik is a lightweight configuration management package for TypeScript applications running on Deno and Node.js. It uses [TypeBox](https://github.com/sinclairzx83/typebox)-generated schemas to validate configurations and produce command line interfaces.  

Features:

- **JSON5 support** - Write your configuration files in JSON5 format, designed for humans to use
- **Type-safe configuration** - Validate configurations using TypeBox schemas, with automatic support for TypeScript type definitions
- **CLI generation** - Automatically create formatted CLI interfaces from your configuration schemas
- **Secrets management** - Safely manage API keys and other secrets by referencing environment variables and other secret stores
