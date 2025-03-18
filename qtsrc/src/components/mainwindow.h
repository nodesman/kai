#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSplitter>
#include <QProcess>  // Include QProcess
#include "chatinterface/chatinterface.h"
#include "../models/diffmodel.h"
#include "../models/chatmodel.h"
#include "backend/communicationmanager.h"

class DiffView; // Forward declaration
class ChatInterface;

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    void startNodeProcess();

    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private slots:
    void handleRequestPendingChanged(bool pending);
    void handleChatMessageReceived(const QString &message);
    void handleErrorReceived(const QString &errorMessage);
private:
    void setupUI();
    void populatePlaceholderChatData();

    QSplitter *mainSplitter;
    ChatInterface *chatInterface;
    DiffView *diffView;
    DiffModel *diffModel;
    ChatModel *chatModel;
    QProcess *nodeProcess;  // The Node.js process
    CommunicationManager * communicationManager;

};

#endif // MAINWINDOW_H