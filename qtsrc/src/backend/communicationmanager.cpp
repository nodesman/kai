#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QTextStream>
#include <QCoreApplication>
#include <unistd.h>
#include <QFileInfo>
#include <QJsonArray>
#include <QStandardPaths>
#include <QTimer>
#include <QSocketNotifier>

#ifdef Q_OS_WIN
#include <io.h>
#define STDIN_FILENO _fileno(stdin)
#endif

CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent)
    , m_chatModel(chatModel)
    , m_diffModel(diffModel)
    , m_stdinStream(nullptr)
    , m_stdoutStream(nullptr)
{
    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
                m_chatModel->addMessage(message, static_cast<ChatModel::MessageType>(messageType));
            });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel);
    connect(this, &CommunicationManager::ready, this, &CommunicationManager::sendReadySignal);

    // --- Stdin Setup ---
    m_stdinStream = new QTextStream(stdin, QIODevice::ReadOnly);
    m_stdoutStream = new QTextStream(stdout, QIODevice::WriteOnly);

#ifndef Q_OS_WIN
    m_stdinNotifier = new QSocketNotifier(STDIN_FILENO, QSocketNotifier::Read, this);
    connect(m_stdinNotifier, &QSocketNotifier::activated, this, &CommunicationManager::readStdin);
    m_stdinNotifier->setEnabled(true);
#else
    // Placeholder (still not ideal)
    m_stdinNotifier = new QSocketNotifier(STDIN_FILENO, QSocketNotifier::Read, this);
    connect(m_stdinNotifier, &QSocketNotifier::activated, this, &CommunicationManager::readStdin);
    m_stdinNotifier->setEnabled(true);
#endif

    QTimer::singleShot(0, this, &CommunicationManager::ready); // Emit ready after event loop starts
}

void CommunicationManager::sendReadySignal() {
    QTextStream errStream(stderr, QIODevice::WriteOnly); // Use stderr
    errStream << "READY\n";
    errStream.flush();
}


void CommunicationManager::readStdin() {
    qDebug() << "In readStdin";

    qint64 bytesAvailable = m_stdinStream->device()->bytesAvailable();
    qDebug() << "  Bytes available on stdin: " << bytesAvailable;

    while (bytesAvailable > 0) {
        qDebug() << "    Entering while loop (bytesAvailable > 0)";
        QString line = m_stdinStream->readLine();
        qDebug() << "    readLine() returned: '" << line << "'";

        if (line.isEmpty()) {
            qDebug() << "    Line is empty. Skipping.";
            bytesAvailable = m_stdinStream->device()->bytesAvailable(); // Update
            qDebug() << "        Updated bytesAvailable (empty check): " << bytesAvailable;
            continue;
        }

        QJsonParseError error;
        QJsonDocument doc = QJsonDocument::fromJson(line.toUtf8(), &error);
        qDebug() << "    Attempted to parse JSON. Error status: " << error.errorString();

        if (error.error != QJsonParseError::NoError) {
            emit errorReceived("JSON Parse Error: " + error.errorString());
            bytesAvailable = m_stdinStream->device()->bytesAvailable();
            qDebug() << "      Updated bytesAvailable (parse error): " << bytesAvailable;
            continue;
        }

        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            qDebug() << "    Received JSON from stdin: " << obj;
            processReceivedJson(obj);
        } else {
            emit errorReceived("Received data is not a JSON object.");
        }

        bytesAvailable = m_stdinStream->device()->bytesAvailable();
        qDebug() << "    Updated bytesAvailable (end of loop): " << bytesAvailable;
    }

    qDebug() << "  Exiting while loop (bytesAvailable <= 0)";
}

CommunicationManager::~CommunicationManager()
{
    delete m_stdinNotifier;
    delete m_stdinStream;
    delete m_stdoutStream;
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
    *m_stdoutStream << jsonData << "\n";
    m_stdoutStream->flush();
}

void CommunicationManager::processReceivedJson(const QJsonObject& obj)
{
    qDebug() << "Entering processReceivedJson.  Received object: " << obj;

    if (obj["type"] == "chatMessage") {
        qDebug() << "  Processing chatMessage";
        if (obj.contains("messageType") && obj["messageType"].isString() &&
            obj.contains("text") && obj["text"].isString()) {

            QString messageTypeStr = obj["messageType"].toString();
            ChatModel::MessageType messageType;

            if (messageTypeStr == "User") {
                messageType = ChatModel::User;
            } else if (messageTypeStr == "LLM") {
                messageType = ChatModel::LLM;
            } else {
                qDebug() << "    Invalid messageType: " << messageTypeStr;
                emit errorReceived("Invalid messageType in chatMessage");
                return;
            }

            qDebug() << "    Emitting chatMessageReceived.  Message: " << obj["text"].toString() << ", Type: " << messageTypeStr;
            emit chatMessageReceived(obj["text"].toString(), messageType);

        } else {
            qDebug() << "    Invalid chatMessage format.";
            emit errorReceived("Invalid chatMessage format.");
        }
    } else if (obj["type"] == "requestStatus") {
        qDebug() << "  Processing requestStatus";
        if (obj.contains("status") && obj["status"].isBool()) {
            qDebug() << "    Emitting requestStatusChanged: " << obj["status"].toBool();
            emit requestStatusChanged(obj["status"].toBool());

        } else {
            qDebug() << "    Invalid requestStatus format.";
            emit errorReceived("Invalid requestStatus format");
        }
    } else if (obj["type"] == "diffApplied") {
        qDebug() << "  Processing diffApplied";
        emit diffApplied();

    } else if (obj["type"] == "diffResult") {
        qDebug() << "  Processing diffResult";
        if (obj.contains("files") && obj["files"].isArray()) {
            QJsonArray filesArray = obj["files"].toArray();
            QStringList filePaths;
            QList<QString> fileContents;

            for (const QJsonValue &fileVal : filesArray) {
                if (fileVal.isObject()) {
                    QJsonObject fileObj = fileVal.toObject();
                    if (fileObj.contains("path") && fileObj["path"].isString() &&
                        fileObj.contains("content") && fileObj["content"].isString()) {
                        filePaths << fileObj["path"].toString();
                        fileContents << fileObj["content"].toString();
                    } else {
                        qDebug() << "    Invalid file object in diffResult";
                        emit errorReceived("Invalid file object in diffResult");
                        return;
                    }
                } else {
                    qDebug() << "    Invalid element in files array (not an object)";
                    emit errorReceived("Invalid element in files array (not an object)");
                    return;
                }
            }
            qDebug() << "    Emitting diffResultReceived.  Paths: " << filePaths; // Log the paths
            emit diffResultReceived(filePaths, fileContents);

        } else {
            qDebug() << "    Invalid diffResult format.";
            emit errorReceived("Invalid diffResult format.");
        }
    } else {
        qDebug() << "  Unknown message type: " << obj["type"];
    }

    qDebug() << "Exiting processReceivedJson";
}

void CommunicationManager::initializeWithHardcodedData() {
    // Use QTimer::singleShot to introduce delays.  This avoids blocking the main thread.

    QTimer::singleShot(100, this, [this]() {
        m_chatModel->addMessage("Hello, this is a test message from the User.", ChatModel::User);
        m_stdinNotifier->setEnabled(true);
    });

    QTimer::singleShot(500, this, [this]() {
        m_chatModel->addMessage("And this is a response from the LLM.", ChatModel::LLM);
        m_stdinNotifier->setEnabled(true);
    });

    QTimer::singleShot(1000, this, [this]() {
        m_chatModel->addMessage("Another user message.", ChatModel::User);
        m_stdinNotifier->setEnabled(true);
    });

    QTimer::singleShot(1500, this, [this]() {
        m_chatModel->addMessage("Another LLM response.", ChatModel::LLM);
        m_stdinNotifier->setEnabled(true);
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
         m_stdinNotifier->setEnabled(true);

        qDebug() << "Initialized with hardcoded data."; // Confirm in output
    });
}