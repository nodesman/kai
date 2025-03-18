// mainwindow.h
#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QTextEdit>
#include <QLineEdit>
#include <QSplitter>
#include "diffview.h" // Include DiffView


class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

    private slots: // Add the slots section
        void sendPrompt();

private:
    void setupUI();
    // void createSampleDiff(); // Removed: We'll use the model now.

    QSplitter *mainSplitter;
    QSplitter *leftSplitter;

    QTextEdit *conversationHistory;
    QLineEdit *promptInput;
    // QTextEdit *llmResponse; // Removed:  We're using DiffView
    DiffView *diffView;  // Pointer to DiffView
    DiffModel *diffModel; // Pointer to DiffModel
    void populatePlaceholderData();
};

#endif // MAINWINDOW_H