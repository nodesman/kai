// mainwindow.h
#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSplitter>
#include "diffviewer/diffview.h"
#include "chatinterface/chatinterface.h" // Include the new ChatInterface
#include "../models/diffmodel.h" //For the DiffModel

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private:
    void setupUI();

    void populatePlaceholderChatData();

    void populatePlaceholderChatData(ChatModel *chatModel);

    QSplitter *mainSplitter;
    DiffView *diffView;
    DiffModel *diffModel;
    ChatInterface *chatInterface; // Use the new ChatInterface widget
    void simulateChatInteraction();
    ChatModel * chatModel;
};

#endif // MAINWINDOW_H