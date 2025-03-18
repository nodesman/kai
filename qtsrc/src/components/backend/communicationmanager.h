// communicationmanager.h
#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QString>
#include <QProcess> //If you use a child process
#include <QJsonDocument>

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message);
    void changesApplied(bool success);
    void requestPendingChanged(bool pending);
    void errorReceived(const QString &errorMessage);
    // ... other signals ...

public:
    CommunicationManager(QObject *parent = nullptr);

    void applyChanges(const QJsonObject &changes);

    private slots:
        void processReadyReadStandardOutput();
    // ... other slots ...

private:
    QProcess *nodeProcess; //If you use a child process
public slots:
    void sendChatMessage(const QString &message);


    void sendJson(const QJsonObject &obj);
};

#endif