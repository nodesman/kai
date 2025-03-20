#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QTextStream>
#include <QCoreApplication>
#include <QTimer>
#include <QStandardPaths>
#include <QDir>
#include <QJsonArray>


CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent)
    , m_chatModel(chatModel)
    , m_diffModel(diffModel)
    , m_fileWatcher(new QFileSystemWatcher(this))
    , m_buffer("")  // Initialize the buffer
{
    // Connect signals for chat and diff interaction
    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
        m_chatModel->addMessage(message, static_cast<ChatModel::MessageType>(messageType));
    });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel);
    connect(this, &CommunicationManager::ready, this, &CommunicationManager::sendReadySignal);

    // --- File Setup ---
    QString homePath = QStandardPaths::writableLocation(QStandardPaths::HomeLocation);
    m_commFilePath = QDir(homePath).filePath("communication.json");

    // Create or truncate the file
    QFile commFile(m_commFilePath);
    if (commFile.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
        commFile.close();
    } else {
        qCritical() << "Could not create or truncate communication file:" << m_commFilePath;
        //  Consider exiting the application here, as communication is impossible.
        QCoreApplication::exit(1); // Exit with an error code.
        return;
    }

     qDebug() << "Communication file:" << m_commFilePath;


    // Watch the file for changes
    m_fileWatcher->addPath(m_commFilePath);
    connect(m_fileWatcher, &QFileSystemWatcher::fileChanged, this, &CommunicationManager::onFileChanged);

    QTimer::singleShot(0, this, &CommunicationManager::ready); // Emit ready after the event loop starts
}

CommunicationManager::~CommunicationManager()
{
    // Clean up:  Remove the file (optional, depending on your needs).
    QFile::remove(m_commFilePath);
}

void CommunicationManager::sendReadySignal() {
    QTextStream errStream(stderr, QIODevice::WriteOnly); // Use stderr
    errStream << "READY\n";
    errStream.flush();
}


void CommunicationManager::onFileChanged(const QString &path)
{
    if (path != m_commFilePath) return; // Safety check

     qDebug() << "File changed:" << path;

    QFile commFile(m_commFilePath);
    if (!commFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
        qCritical() << "Could not open communication file for reading:" << m_commFilePath;
        return;
    }

    QTextStream in(&commFile);
    // in.setCodec("UTF-8"); // Important: Ensure correct encoding

    while (!in.atEnd()) {
        QString newData = in.readAll(); // Read *all* new data
         qDebug() << "New data read:" << newData;

        m_buffer += newData; // Append to the buffer

        // Process complete lines from the buffer
        int newlineIndex;
        while ((newlineIndex = m_buffer.indexOf('\n')) != -1) {
            QString completeLine = m_buffer.left(newlineIndex);
            m_buffer.remove(0, newlineIndex + 1); // Remove the processed line + newline

             qDebug() << "Complete line:" << completeLine;

            // --- JSON Parsing ---
            QJsonParseError error;
            QJsonDocument doc = QJsonDocument::fromJson(completeLine.toUtf8(), &error);
            if (error.error != QJsonParseError::NoError) {
                emit errorReceived("JSON Parse Error: " + error.errorString());
                continue; // Skip to the next line
            }

            if (doc.isObject()) {
                QJsonObject obj = doc.object();
                 qDebug() << "Received JSON:" << obj;
                processReceivedJson(obj);
            } else {
                emit errorReceived("Received data is not a JSON object.");
            }
        }
    }

    commFile.close();

    // Re-add the path.  QFileSystemWatcher sometimes stops watching after a change.
    m_fileWatcher->addPath(m_commFilePath);
}


void CommunicationManager::sendJson(const QJsonObject &obj)
{
    QFile commFile(m_commFilePath);
    if (!commFile.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
        qCritical() << "Could not open communication file for writing:" << m_commFilePath;
        return;
    }

    QTextStream out(&commFile);
    // out.setCodec("UTF-8"); // Important: Ensure consistent encoding

    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact); // Or Indented, for debugging
    out << jsonData << "\n"; // Write the JSON data + newline
    out.flush(); // Ensure data is written immediately

     qDebug() << "Sent JSON:" << QString(jsonData);
    commFile.close();
}

void CommunicationManager::processReceivedJson(const QJsonObject &obj) {
    // The rest of this function is *identical* to your previous version,
    // as the JSON processing logic remains the same.  I've included
    // the full, improved version for completeness.
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


void CommunicationManager::sendChatMessage(const QString &message) {
    sendJson({
        {"type", "chatMessage"},
        {"text", message}
    });
}

void CommunicationManager::applyDiff() {
    sendJson({{"type", "applyDiff"}});
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