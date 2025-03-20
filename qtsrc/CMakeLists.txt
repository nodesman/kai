cmake_minimum_required(VERSION 3.16)

project(KaiDiff LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Use CMAKE_PREFIX_PATH instead of Qt6_DIR.  Prefer environment variable.
if(NOT DEFINED CMAKE_PREFIX_PATH)
    if(DEFINED ENV{QT6_DIR})
        set(CMAKE_PREFIX_PATH "$ENV{QT6_DIR}")
        message(STATUS "Using Qt from QT6_DIR: $ENV{QT6_DIR}")
    endif()
endif()

find_package(Qt6 REQUIRED COMPONENTS Widgets Gui Core Network)

add_executable(KaiDiff
        src/main.cpp
        src/components/mainwindow.cpp
        src/components/mainwindow.h
        src/components/diffviewer/diffview.h
        src/components/diffviewer/diffview.cpp
        src/models/diffmodel.cpp
        src/models/diffmodel.h
        src/components/diffviewer/diffcontentwidget.cpp
        src/components/diffviewer/diffcontentwidget.h
        src/components/chatinterface/chatinterface.cpp
        src/components/chatinterface/chatinterface.h
        src/models/ChatModel.cpp
        src/models/ChatModel.h
        src/components/chatinterface/conversationhistory.cpp
        src/components/chatinterface/conversationhistory.h
        src/backend/CommunicationManager.cpp
        src/backend/CommunicationManager.h
        src/components/chatinterface/PromptEntry.cpp
        src/components/chatinterface/promptentry.h
)

# --- Console Subsystem Handling (Cross-Platform) ---

# For Windows, use WIN32_EXECUTABLE with set_target_properties
if(WIN32)
    set_target_properties(KaiDiff PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

# For macOS, we need to avoid creating an app bundle *and* set a specific
# linker flag to keep the console.
if(APPLE)
    set_target_properties(KaiDiff PROPERTIES MACOSX_BUNDLE FALSE) # Don't create a .app bundle

    if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
        set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version to target")
        message(STATUS "Setting CMAKE_OSX_DEPLOYMENT_TARGET to ${CMAKE_OSX_DEPLOYMENT_TARGET}")
    endif()

endif()

# --- End Console Subsystem Handling ---

target_link_libraries(KaiDiff PRIVATE Qt6::Widgets Qt6::Gui Qt6::Core Qt6::Network)

set_target_properties(KaiDiff PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
install(TARGETS KaiDiff DESTINATION bin)