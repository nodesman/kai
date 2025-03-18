cmake_minimum_required(VERSION 3.16)

project(KaiDiff LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Use CMAKE_PREFIX_PATH instead of Qt6_DIR.  Prefer environment variable.
#  Remove the explicit setting of Qt6_DIR. CMake will use CMAKE_PREFIX_PATH.
# set(Qt6_DIR "/Users/rajsekharan/Qt/6.5.3/macos/lib/cmake/Qt6")  # REMOVE THIS LINE

# Check if QT6_DIR is set as environment variable.  If so, use it.
if(NOT DEFINED CMAKE_PREFIX_PATH)
    if(DEFINED ENV{QT6_DIR})
        set(CMAKE_PREFIX_PATH "$ENV{QT6_DIR}")
        message(STATUS "Using Qt from QT6_DIR: $ENV{QT6_DIR}")
    endif()
endif()


find_package(Qt6 REQUIRED COMPONENTS Widgets Gui Core) # Request all necessary modules

add_executable(KaiDiff
        src/main.cpp
        src/components/mainwindow.cpp
        src/components/mainwindow.h
        src/components/diffviewer/diffview.h
        src/components/diffviewer/diffview.cpp
        src/models/diffmodel.cpp
        src/models/diffmodel.h
        src/components/diffviewer/DiffContentWidget.cpp
        src/components/diffviewer/DiffContentWidget.h
        src/components/ChatInterface.cpp
        src/components/ChatInterface.h
        src/models/ChatModel.cpp
        src/models/ChatModel.h
)

# Link against all necessary Qt modules
target_link_libraries(KaiDiff PRIVATE Qt6::Widgets Qt6::Gui Qt6::Core)

# Optional: Set the output directory
set_target_properties(KaiDiff PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# Optional: For installation (if you want to install the application)
install(TARGETS KaiDiff DESTINATION bin)