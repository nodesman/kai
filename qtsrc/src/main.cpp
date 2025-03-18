// main.cpp
#include "components/mainwindow.h"
#include <QApplication>



int main(int argc, char *argv[])
{
    qInstallMessageHandler([](QtMsgType type, const QMessageLogContext &context, const QString &msg) {
    QByteArray localMsg = msg.toLocal8Bit();
    const char *severity = nullptr;
    switch (type) {
    case QtDebugMsg:
        severity = "Debug";
        break;
    case QtWarningMsg:
        severity = "Warning";
        break;
    case QtCriticalMsg:
        severity = "Critical";
        break;
    case QtFatalMsg:
        severity = "Fatal";
        break;
    case QtInfoMsg:
        severity = "Info";
        break;
    }

    if(severity){
        fprintf(stderr, "%s: %s (%s:%u, %s)\n", severity, localMsg.constData(), context.file, context.line, context.function);
    } else {
        fprintf(stderr, "%s\n", localMsg.constData());
    }
    fflush(stderr);
});
    QApplication a(argc, argv);
    MainWindow w;
    w.show();
    return a.exec();
}