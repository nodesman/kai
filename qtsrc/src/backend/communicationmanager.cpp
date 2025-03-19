#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QTextStream>
#include <QCoreApplication>  //For QCoreApplication::processEvents


CommunicationManager::CommunicationManager(QObject *parent) : QObject(parent), stdinReader(":/stdin") // Important initialization!
{
    // Connect to readyRead signal.
    connect(&stdinReader, &QFile::readyRead, this, &CommunicationManager::readFromStdin);

    // Open stdin for reading.
    if (!stdinReader.open(QIODevice::ReadOnly | QIODevice::Text)) { // Open in Text mode.
        qDebug() << "Error: Could not open stdin for reading.";
        //  Consider exiting the program or emitting an error signal.
        //  QCoreApplication::exit(1); //  Or a more graceful exit.
        emit errorReceived("Could not open stdin"); // Better to emit a signal
        return;
    }
}

void CommunicationManager::sendChatMessage(const QString &message) {
    sendJson({
        {"type", "chatMessage"},
        {"text", message}
    });
}

void CommunicationManager::applyChanges(const QJsonObject &changes) {
    sendJson({
      {"type", "applyChanges"},
      {"changes", changes}
    });
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact);

    // Correct way to use stdout with QTextStream:
    QTextStream stream(stdout); // Create a QTextStream that writes to standard output.
    stream << jsonData << "\n";  // Write the JSON data and a newline.
    stream.flush();            // Ensure the data is sent immediately.
}

void CommunicationManager::readFromStdin() {
    //Read all available data, but process it line by line
    while(stdinReader.canReadLine()){
        QByteArray data = stdinReader.readLine();
        QJsonParseError error;
        QJsonDocument doc = QJsonDocument::fromJson(data, &error);

        if (error.error != QJsonParseError::NoError) {
            qDebug() << "JSON parse error:" << error.errorString();
            emit errorReceived("JSON Parse Error: " + error.errorString()); // Send an error
            return;
        }

        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            qDebug() << "Received JSON:" << obj;

            if (obj["type"] == "applyChanges") {
                if(obj.contains("changes") && obj["changes"].isObject()){
                    // In a real application, you'd likely do more with the changes.
                    // You might pass them to another part of your application.
                    emit changesApplied(true); // Indicate success.  Adjust as needed.
                }
            }
            // Add other message type handling here (else if...)
              else {
                 qDebug() << "Unknown message type:" << obj["type"];
             }
        } else {
            qDebug() << "Received data is not a JSON object.";
            emit errorReceived("Received data is not a JSON object.");
        }
    }
}