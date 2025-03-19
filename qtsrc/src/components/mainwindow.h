#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSplitter>
#include <QProcess>  // Include QProcess

#include "../backend/communicationmanager.h"
#include "chatinterface/chatinterface.h" // Assuming the header is here
#include "../models/diffmodel.h"      // Assuming the header is here
#include "../models/chatmodel.h"      // Assuming the header is here.



class DiffView;  // Forward declaration.
class ChatInterface;


class MainWindow : public QMainWindow
{
    Q_OBJECT

public:

    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();
private:

    void setupUI();
    void populatePlaceholderChatData();

    QSplitter *mainSplitter;
    ChatInterface *chatInterface;  //Use pointer
    DiffView *diffView; // Make it a member variable, as we need to access it.
    DiffModel *diffModel;
    ChatModel* chatModel;
    QProcess *nodeProcess; // Added process
    CommunicationManager *communicationManager;

private slots:
        // void handleRequestPendingChanged(bool pending);

};
#endif // MAINWINDOW_H