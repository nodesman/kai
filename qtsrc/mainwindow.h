#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QTextEdit>
#include <QLineEdit>
#include <QSplitter>
#include "diffview.h" // Include our new DiffView

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private:
    void setupUI(); // Function to create and arrange widgets
    void sendPrompt();
    void createSampleDiff();  //ADDED - create sample diff

    QSplitter *mainSplitter; // Main splitter for left/right halves
    QSplitter *leftSplitter;  // Splitter for conversation/input on the left

    QTextEdit *conversationHistory;
    QLineEdit *promptInput;
    QTextEdit *llmResponse;
    DiffView* diffView; // ADDED: DiffView member
};
#endif // MAINWINDOW_H

