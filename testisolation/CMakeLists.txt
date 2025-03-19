cmake_minimum_required(VERSION 3.16)  # Keep minimum version consistent
project(testisolation LANGUAGES CXX)

# Standard settings
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Automatic Qt handling (moc, rcc, uic)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Find Qt6 (Widgets, Gui, Core are essential for a GUI app)
find_package(Qt6 REQUIRED COMPONENTS Widgets Gui Core)

# Handle Qt6 installation path (use CMAKE_PREFIX_PATH, check QT6_DIR)
if(NOT CMAKE_PREFIX_PATH)
    if(DEFINED ENV{QT6_DIR})
        set(CMAKE_PREFIX_PATH "$ENV{QT6_DIR}")
        message(STATUS "Using Qt from QT6_DIR: $ENV{QT6_DIR}")
    endif()
endif()

# --- Define the executable ---
add_executable(testisolation main.cpp)

# --- Console Subsystem Handling (Cross-Platform) ---
# This section is *crucial* for stdin/stdout to work correctly.

# For Windows, use WIN32_EXECUTABLE. This tells the linker to create a console
# subsystem application, even though it has a GUI.
if(WIN32)
    set_target_properties(testisolation PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

# For macOS, we need to do two things:
# 1. Avoid creating an application bundle (.app). Bundles don't have a console by default.
# 2. Use specific linker flags to ensure the console is kept.
if(APPLE)
    set_target_properties(testisolation PROPERTIES MACOSX_BUNDLE FALSE) # No .app bundle
    set_target_properties(testisolation PROPERTIES
            LINK_FLAGS "-Wl,-macosx_version_min,10.15 -Wl,-no_pie" # Keep the console
    )
endif()
# --- End Console Subsystem Handling ---

# --- Linking ---
# Link the executable against the required Qt libraries.  Use PRIVATE.
target_link_libraries(testisolation PRIVATE Qt6::Widgets Qt6::Gui Qt6::Core)

# --- Optional Settings ---

# Set the output directory for the executable (optional, but good practice).
set_target_properties(testisolation PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# Installation rule (optional, for if you want to install the application)
install(TARGETS testisolation DESTINATION bin)