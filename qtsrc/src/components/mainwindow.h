#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSplitter>
#include <QProcess>  // Include QProcess
#include "chatinterface/chatinterface.h"
#include "../models/diffmodel.h"
#include "../models/chatmodel.h"

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
        // void simulateChatInteraction(); // Keep for initial demonstration
    void processReadyReadStandardOutput(); // Handle messages FROM Node.js
    // void processFinished(int exitCode, QProcess::ExitStatus exitStatus);
    // void processErrorOccurred(QProcess::ProcessError error);
    void sendPromptToNodeJs(const QString &prompt);

private:
    void setupUI();
    void populatePlaceholderChatData();



    QSplitter *mainSplitter;
    ChatInterface *chatInterface;
    DiffView *diffView;
    DiffModel *diffModel;
    ChatModel *chatModel;
    QProcess *nodeProcess;  // The Node.js process
};

#endif // MAINWINDOW_H