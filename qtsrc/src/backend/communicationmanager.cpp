// src/backend/communicationmanager.cpp
#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QTextStream>
#include <QCoreApplication>
#include <unistd.h>  // For STDIN_FILENO on POSIX
#include <QFileInfo>
#include <QJsonArray>
#include <QStandardPaths> //For standard paths
#include <QTimer>
#ifdef Q_OS_WIN
#include <io.h>      // For _fileno on Windows
#define STDIN_FILENO _fileno(stdin)
#endif

CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent)
{
    m_chatModel = chatModel;
    m_diffModel = diffModel;

    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
                m_chatModel->addMessage(message, static_cast<ChatModel::MessageType>(messageType));
            });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel);



    // --- Stdin Setup ---
#ifndef Q_OS_WIN //Not windows
    m_stdinNotifier = new QSocketNotifier(STDIN_FILENO, QSocketNotifier::Read, this);
    connect(m_stdinNotifier, &QSocketNotifier::activated, this, &CommunicationManager::readStdin);
    m_stdinNotifier->setEnabled(true); // Enable it!
#else //Windows
    // QSocketNotifier doesn't work reliably with stdin on Windows.
    // A better approach on Windows is to use a named pipe or QLocalSocket.
    //  We use a timer for demonstration only.  This is NOT ideal.
    QTimer *stdinTimer = new QTimer(this);
    connect(stdinTimer, &QTimer::timeout, this, &CommunicationManager::readStdin);
    stdinTimer->start(100); // Check every 100ms. *Not* a good long-term solution.
#endif
    m_stdinStream = new QTextStream(stdin, QIODevice::ReadOnly); //For reading
    // --- End Stdin Setup ---

    initializeWithHardcodedData(); // Call the initialization function
}

void CommunicationManager::readStdin() {
#ifndef Q_OS_WIN
    if (!m_stdinNotifier->isEnabled()) return;
#endif

    // while (!m_stdinStream->atEnd()) //Check for data and read until end of line
    while(m_stdinStream->device()->bytesAvailable() > 0) //Check for any available bytes
    {
        QString line = m_stdinStream->readLine();

        if (line.isEmpty()) continue;

        QJsonParseError error;
        QJsonDocument doc = QJsonDocument::fromJson(line.toUtf8(), &error);
        if (error.error != QJsonParseError::NoError) {
            qDebug() << "JSON parse error:" << error.errorString();
            emit errorReceived("JSON Parse Error: " + error.errorString());
            continue;
        }

        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            qDebug() << "Received JSON from stdin:" << obj; //VERY important

            processReceivedJson(obj); //Call processing function

        } else {
            qDebug() << "Received data is not a JSON object.";
            emit errorReceived("Received data is not a JSON object.");
        }
    }
}

CommunicationManager::~CommunicationManager() {

#ifndef Q_OS_WIN //Cleanup for posix
    delete m_stdinNotifier; // Clean up
#endif
    delete m_stdinStream;
}

void CommunicationManager::sendChatMessage(const QString &message) {
    sendJson({
        {"type", "chatMessage"},
        {"text", message}
    });
}

void CommunicationManager::applyDiff() {
    sendJson({{"type", "applyDiff"}});
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact);
}

void CommunicationManager::processReceivedJson(const QJsonObject &obj) {
    if (obj["type"] == "chatMessage") {
        if (obj.contains("messageType") && obj["messageType"].isString() &&
            obj.contains("text") && obj["text"].isString()) {
            QString messageTypeStr = obj["messageType"].toString();
            ChatModel::MessageType messageType;

            if (messageTypeStr == "User") {
                messageType = ChatModel::User;
            } else if (messageTypeStr == "LLM") {
                messageType = ChatModel::LLM;
            } else {
                emit errorReceived("Invalid messageType in chatMessage");
                return; // Exit if invalid type
            }
            emit chatMessageReceived(obj["text"].toString(), messageType);
        } else {
            emit errorReceived("Invalid chatMessage format.");
        }
    } else if (obj["type"] == "requestStatus") {
        //... rest of the processing.
        if (obj.contains("status") && obj["status"].isBool()) {
            emit requestStatusChanged(obj["status"].toBool());
        } else {
            emit errorReceived("Invalid requestStatus format");
        }
    } else if (obj["type"] == "diffApplied") {
        emit diffApplied();
    } else if (obj["type"] == "diffResult") {
        if (obj.contains("files") && obj["files"].isArray()) {
            QJsonArray filesArray = obj["files"].toArray();
            QStringList filePaths;
            QList<QString> fileContents;

            for (const QJsonValue &fileVal: filesArray) {
                if (fileVal.isObject()) {
                    QJsonObject fileObj = fileVal.toObject();
                    if (fileObj.contains("path") && fileObj["path"].isString() &&
                        fileObj.contains("content") && fileObj["content"].isString()) {
                        filePaths << fileObj["path"].toString();
                        fileContents << fileObj["content"].toString();
                    } else {
                        emit errorReceived("Invalid file object in diffResult");
                        return;
                    }
                } else {
                    emit errorReceived("Invalid element in files array (not an object)");
                    return;
                }
            }
            emit diffResultReceived(filePaths, fileContents);
        } else {
            emit errorReceived("Invalid diffResult format.");
        }
    } else {
        qDebug() << "Unknown message type:" << obj["type"];
    }
}

void CommunicationManager::initializeWithHardcodedData() {
    // Use QTimer::singleShot to introduce delays.  This avoids blocking the main thread.

    QTimer::singleShot(100, this, [this]() {
        m_chatModel->addMessage("Hello, this is a test message from the User.", ChatModel::User);
    });

    QTimer::singleShot(500, this, [this]() {
        m_chatModel->addMessage("And this is a response from the LLM.", ChatModel::LLM);
    });

    QTimer::singleShot(1000, this, [this]() {
        m_chatModel->addMessage("Another user message.", ChatModel::User);
    });

    QTimer::singleShot(1500, this, [this]() {
        m_chatModel->addMessage("Another LLM response.", ChatModel::LLM);
    });
    QTimer::singleShot(2000, this, [this]() {
        // Hardcoded Diff Data
        QStringList paths = {"file1.cpp", "file2.h", "long_file_name_example.txt"};
        QList<QString> contents = {
            "+Added line 1\n-Removed line 2\nUnchanged line 3",
            "Unchanged line 1\n+Added line 2",
            "-Removed line 1\n+Added very loooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong line"
        };
        m_diffModel->setFiles(paths, contents);

        qDebug() << "Initialized with hardcoded data."; // Confirm in output
    });
}